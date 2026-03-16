/**
 * alert-manager.ts -- Core alert lifecycle (#236)
 *
 * Emit / acknowledge / resolve / auto-resolve / query alerts.
 * Dedup: same type+village within configurable window -> update existing.
 */

import type { Database } from 'bun:sqlite';
import type { Alert, AlertType, AlertSeverity, AlertStatus } from './schemas/alert';
import { appendAudit } from './db';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default dedup window: 5 minutes */
const DEFAULT_DEDUP_WINDOW_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// AlertManager
// ---------------------------------------------------------------------------

export interface AlertManagerOpts {
  /** Dedup window in ms (default 5min) */
  dedupWindowMs?: number;
}

export class AlertManager {
  private readonly db: Database;
  private readonly dedupWindowMs: number;

  constructor(db: Database, opts?: AlertManagerOpts) {
    this.db = db;
    this.dedupWindowMs = opts?.dedupWindowMs ?? DEFAULT_DEDUP_WINDOW_MS;
  }

  /**
   * Emit an alert. Dedup: if same type+village active alert exists within window,
   * increment occurrence_count instead of creating new.
   */
  emit(
    villageId: string,
    type: AlertType,
    severity: AlertSeverity,
    title: string,
    message: string,
    details: Record<string, unknown> = {},
  ): Alert {
    const existing = this.findDedup(villageId, type);
    if (existing) {
      return this.updateExisting(existing, severity, message, details);
    }
    return this.createNew(villageId, type, severity, title, message, details);
  }

  /** Acknowledge: active -> acknowledged */
  acknowledge(alertId: string, actor: string): Alert {
    const alert = this.get(alertId);
    if (!alert) throw new Error(`Alert not found: ${alertId}`);
    if (alert.status !== 'active') {
      throw new Error(`Cannot acknowledge alert in status: ${alert.status}`);
    }

    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE alerts SET status = 'acknowledged', acknowledged_by = ?, acknowledged_at = ?,
        version = version + 1, updated_at = ? WHERE id = ?
    `).run(actor, now, now, alertId);

    appendAudit(this.db, 'alert', alertId, 'acknowledged', { actor }, actor);

    return this.get(alertId)!;
  }

  /** Resolve: active|acknowledged -> resolved */
  resolve(alertId: string, actor: string, note?: string): Alert {
    const alert = this.get(alertId);
    if (!alert) throw new Error(`Alert not found: ${alertId}`);
    if (alert.status !== 'active' && alert.status !== 'acknowledged') {
      throw new Error(`Cannot resolve alert in status: ${alert.status}`);
    }

    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE alerts SET status = 'resolved', resolved_at = ?,
        version = version + 1, updated_at = ? WHERE id = ?
    `).run(now, now, alertId);

    appendAudit(this.db, 'alert', alertId, 'resolved', { actor, note }, actor);

    return this.get(alertId)!;
  }

  /** Auto-resolve: active -> auto_resolved (system action) */
  autoResolve(alertId: string, reason: string): Alert {
    const alert = this.get(alertId);
    if (!alert) throw new Error(`Alert not found: ${alertId}`);
    if (alert.status !== 'active') {
      throw new Error(`Cannot auto-resolve alert in status: ${alert.status}`);
    }

    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE alerts SET status = 'auto_resolved', resolved_at = ?,
        auto_action_taken = ?, version = version + 1, updated_at = ? WHERE id = ?
    `).run(now, reason, now, alertId);

    appendAudit(this.db, 'alert', alertId, 'auto_resolved', { reason }, 'system');

    return this.get(alertId)!;
  }

  /** Get a single alert by ID */
  get(alertId: string): Alert | null {
    const row = this.db.prepare('SELECT * FROM alerts WHERE id = ?').get(alertId) as Record<string, unknown> | null;
    if (!row) return null;
    return this.parseRow(row);
  }

  /** List alerts for a village with optional filters */
  list(
    villageId: string,
    opts?: { status?: AlertStatus; type?: AlertType; severity?: AlertSeverity; limit?: number },
  ): Alert[] {
    const conditions = ['village_id = ?'];
    const params: unknown[] = [villageId];

    if (opts?.status) {
      conditions.push('status = ?');
      params.push(opts.status);
    }
    if (opts?.type) {
      conditions.push('type = ?');
      params.push(opts.type);
    }
    if (opts?.severity) {
      conditions.push('severity = ?');
      params.push(opts.severity);
    }

    const limit = opts?.limit ?? 50;
    const sql = `SELECT * FROM alerts WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params as [string, ...string[]]) as Record<string, unknown>[];
    return rows.map((r) => this.parseRow(r));
  }

  /** Count active alerts for a village */
  countActive(villageId: string): number {
    const row = this.db.prepare(
      "SELECT COUNT(*) as cnt FROM alerts WHERE village_id = ? AND status = 'active'"
    ).get(villageId) as { cnt: number };
    return row.cnt;
  }

  /**
   * Find active alerts of a specific type for auto-resolve.
   * Used by trigger functions to resolve stale alerts.
   */
  findActiveByType(villageId: string, type: AlertType): Alert[] {
    const rows = this.db.prepare(
      "SELECT * FROM alerts WHERE village_id = ? AND type = ? AND status = 'active' ORDER BY created_at DESC"
    ).all(villageId, type) as Record<string, unknown>[];
    return rows.map((r) => this.parseRow(r));
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /** Find dedup candidate: active alert of same type within window */
  private findDedup(villageId: string, type: AlertType): Alert | null {
    if (this.dedupWindowMs <= 0) return null; // disabled
    const cutoff = new Date(Date.now() - this.dedupWindowMs).toISOString();
    const row = this.db.prepare(
      `SELECT * FROM alerts WHERE village_id = ? AND type = ? AND status = 'active'
       AND created_at >= ? ORDER BY created_at DESC LIMIT 1`
    ).get(villageId, type, cutoff) as Record<string, unknown> | null;
    if (!row) return null;
    return this.parseRow(row);
  }

  /** Update existing alert (dedup): bump occurrence_count, update severity if escalated */
  private updateExisting(
    existing: Alert,
    severity: AlertSeverity,
    message: string,
    details: Record<string, unknown>,
  ): Alert {
    const now = new Date().toISOString();
    // Escalate severity: only upgrade, never downgrade
    const effectiveSeverity = this.higherSeverity(existing.severity, severity);
    const mergedDetails = { ...existing.details, ...details };

    this.db.prepare(`
      UPDATE alerts SET occurrence_count = occurrence_count + 1,
        severity = ?, message = ?, details = ?,
        version = version + 1, updated_at = ?
      WHERE id = ?
    `).run(effectiveSeverity, message, JSON.stringify(mergedDetails), now, existing.id);

    return this.get(existing.id)!;
  }

  /** Create a new alert */
  private createNew(
    villageId: string,
    type: AlertType,
    severity: AlertSeverity,
    title: string,
    message: string,
    details: Record<string, unknown>,
  ): Alert {
    const id = `alert_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO alerts (id, village_id, type, severity, status, title, message, details,
        occurrence_count, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', ?, ?, ?, 1, 1, ?, ?)
    `).run(id, villageId, type, severity, title, message, JSON.stringify(details), now, now);

    appendAudit(this.db, 'alert', id, 'created', {
      village_id: villageId, type, severity, title,
    }, 'system');

    return this.get(id)!;
  }

  /** Compare severities; return the higher one */
  private higherSeverity(a: AlertSeverity, b: AlertSeverity): AlertSeverity {
    const order: Record<AlertSeverity, number> = {
      info: 0, warning: 1, critical: 2, emergency: 3,
    };
    return order[a] >= order[b] ? a : b;
  }

  /** Parse a DB row into an Alert */
  private parseRow(row: Record<string, unknown>): Alert {
    return {
      id: row.id as string,
      village_id: row.village_id as string,
      type: row.type as AlertType,
      severity: row.severity as AlertSeverity,
      status: row.status as AlertStatus,
      title: row.title as string,
      message: row.message as string,
      details: typeof row.details === 'string' ? JSON.parse(row.details) as Record<string, unknown> : {},
      occurrence_count: row.occurrence_count as number,
      acknowledged_by: (row.acknowledged_by as string) ?? null,
      acknowledged_at: (row.acknowledged_at as string) ?? null,
      resolved_at: (row.resolved_at as string) ?? null,
      auto_action_taken: (row.auto_action_taken as string) ?? null,
      version: row.version as number,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    };
  }
}
