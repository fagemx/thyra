/**
 * stale-detector.ts -- Stale heartbeat detection and auto-cleanup (#231)
 *
 * Detects chiefs whose heartbeats have timed out and performs cleanup:
 *   - Mark timeout on stale running chiefs
 *   - Auto-pause after consecutive timeouts (default 3)
 *   - Record events to Edda (fire-and-forget)
 *   - Cancel Karvi tasks (fire-and-forget)
 *   - Audit trail for all stale events (THY-07)
 *
 * Design: Separate module, testable in isolation, opt-in via DI.
 */

import type { Database } from 'bun:sqlite';
import { appendAudit } from './db';
import type { ChiefEngine, Chief } from './chief-engine';
import type { EddaBridge } from './edda-bridge';
import type { KarviBridge } from './karvi-bridge';

// ---------------------------------------------------------------------------
// Timeout constants (configurable via opts for testing)
// ---------------------------------------------------------------------------

/** Running chief heartbeat timeout (default 2 minutes) */
export const HEARTBEAT_TIMEOUT_MS = 2 * 60 * 1000;

/** Auto-pause after N consecutive timeouts (default 3) */
export const AUTO_PAUSE_THRESHOLD = 3;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StaleDetectorOpts {
  db: Database;
  chiefEngine: ChiefEngine;
  eddaBridge?: EddaBridge;
  karviBridge?: KarviBridge;
  /** Heartbeat timeout threshold (ms), default HEARTBEAT_TIMEOUT_MS */
  heartbeatTimeoutMs?: number;
  /** Consecutive timeouts to trigger auto-pause, default AUTO_PAUSE_THRESHOLD */
  autoPauseThreshold?: number;
}

export interface StaleCleanupResult {
  /** Chiefs marked timeout this cycle */
  timed_out: string[];
  /** Chiefs auto-paused this cycle (reached consecutive timeout threshold) */
  auto_paused: string[];
  /** Karvi task ids cancelled this cycle */
  karvi_cancelled: string[];
}

// ---------------------------------------------------------------------------
// StaleDetector class
// ---------------------------------------------------------------------------

export class StaleDetector {
  private readonly db: Database;
  private readonly chiefEngine: ChiefEngine;
  private readonly eddaBridge?: EddaBridge;
  private readonly karviBridge?: KarviBridge;
  private readonly heartbeatTimeoutMs: number;
  private readonly autoPauseThreshold: number;

  constructor(opts: StaleDetectorOpts) {
    this.db = opts.db;
    this.chiefEngine = opts.chiefEngine;
    this.eddaBridge = opts.eddaBridge;
    this.karviBridge = opts.karviBridge;
    this.heartbeatTimeoutMs = opts.heartbeatTimeoutMs ?? HEARTBEAT_TIMEOUT_MS;
    this.autoPauseThreshold = opts.autoPauseThreshold ?? AUTO_PAUSE_THRESHOLD;
  }

  /**
   * Scan and cleanup stale running chiefs.
   *
   * Flow:
   *   1. Query heartbeat-expired running chiefs
   *   2. Mark timeout on each
   *   3. Check timeout_count -> auto-pause at threshold
   *   4. Record to Edda (fire-and-forget)
   *   5. Cancel Karvi resources (fire-and-forget)
   *   6. Write audit_log
   */
  async cleanup(): Promise<StaleCleanupResult> {
    const result: StaleCleanupResult = {
      timed_out: [],
      auto_paused: [],
      karvi_cancelled: [],
    };

    // 1. Query stale running chiefs
    const staleChiefs = this.chiefEngine.getStaleRunning(this.heartbeatTimeoutMs);

    for (const chief of staleChiefs) {
      // 2. Mark timeout
      this.chiefEngine.markTimeout(chief.id, chief.version);
      result.timed_out.push(chief.id);

      // Audit: timeout detected
      appendAudit(this.db, 'chief', chief.id, 'timeout_detected', {
        last_heartbeat_at: chief.last_heartbeat_at,
        current_run_id: chief.current_run_id,
        timeout_count: chief.timeout_count + 1,
      }, 'stale-detector');

      // 3. Check consecutive timeout -> auto-pause
      // chief.timeout_count is pre-increment value; markTimeout already incremented in DB
      const newCount = chief.timeout_count + 1;
      if (newCount >= this.autoPauseThreshold) {
        this.autoPause(chief, newCount);
        result.auto_paused.push(chief.id);
      }

      // 4. Record to Edda (fire-and-forget)
      if (this.eddaBridge) {
        void this.eddaBridge.recordDecision({
          domain: 'chief',
          aspect: 'timeout',
          value: `heartbeat_timeout:${chief.id}`,
          reason: `Chief ${chief.name} heartbeat timeout (count: ${newCount}). Last heartbeat: ${chief.last_heartbeat_at ?? 'never'}`,
        }).catch(() => { /* Edda offline -- graceful degradation */ });
      }

      // 5. Cancel Karvi task (fire-and-forget)
      if (this.karviBridge && chief.current_run_id) {
        try {
          const cancelled = await this.karviBridge.cancelTask(chief.current_run_id);
          if (cancelled) {
            result.karvi_cancelled.push(chief.current_run_id);
            appendAudit(this.db, 'chief', chief.id, 'karvi_cleanup', {
              run_id: chief.current_run_id,
              cancelled: true,
            }, 'stale-detector');
          }
        } catch {
          // Karvi offline -- graceful degradation
        }
      }

      // 6. Reset run status to idle after cleanup (chief can retry next cycle)
      // Only reset if not auto-paused (paused chiefs stay paused)
      // Use direct SQL to avoid resetting timeout_count (markIdle resets it)
      if (newCount < this.autoPauseThreshold) {
        this.db.prepare(
          "UPDATE chiefs SET current_run_status = 'idle', current_run_id = NULL, updated_at = ? WHERE id = ?"
        ).run(new Date().toISOString(), chief.id);
      }
    }

    return result;
  }

  /** Auto-pause chief after consecutive timeouts */
  private autoPause(chief: Chief, timeoutCount: number): void {
    const reason = `CONSECUTIVE_HEARTBEAT_TIMEOUT: ${timeoutCount} consecutive timeouts, possible adapter failure`;

    // Reset to active+idle so pauseChief works (it requires status = 'active')
    this.db.prepare(
      "UPDATE chiefs SET current_run_status = 'idle', current_run_id = NULL, status = 'active', updated_at = ? WHERE id = ?"
    ).run(new Date().toISOString(), chief.id);

    // Re-fetch to get correct version for pauseChief's optimistic lock
    const fresh = this.chiefEngine.get(chief.id);
    if (fresh && fresh.status === 'active') {
      this.chiefEngine.pauseChief(chief.id, reason);
    }

    appendAudit(this.db, 'chief', chief.id, 'auto_pause', {
      reason,
      timeout_count: timeoutCount,
      last_heartbeat_at: chief.last_heartbeat_at,
    }, 'stale-detector');

    // Record auto-pause to Edda
    if (this.eddaBridge) {
      void this.eddaBridge.recordDecision({
        domain: 'chief',
        aspect: 'auto_pause',
        value: `consecutive_timeout:${chief.id}`,
        reason,
      }).catch(() => { /* Edda offline */ });
    }
  }
}
