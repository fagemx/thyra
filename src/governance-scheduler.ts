/**
 * governance-scheduler.ts -- Timer-driven governance scheduler
 *
 * 定時觸發 chief 決策循環，讓世界自己在動。
 *
 * 核心功能：
 *   - start() / stop() / isRunning(): timer lifecycle
 *   - runOnce(): 執行一輪所有 active villages 的所有 active chiefs
 *   - Non-reentrant: overlap guard 防止並發執行
 *   - Per-chief error isolation: 單一 chief 失敗不影響其他 chief
 *
 * 契約遵守：
 *   - CHIEF-01: 所有決策經 judge pipeline（via executeChiefCycle）
 *   - CHIEF-02: 可配置 intervalMs
 *   - ADAPTER-01: adapter failure 不影響主循環
 *   - THY-07: 每個 cycle 寫 audit_log
 */

import type { Database } from 'bun:sqlite';
import { randomUUID } from 'crypto';
import { appendAudit } from './db';
import { executeChiefCycle, type ChiefCycleResult } from './chief-autonomy';
import type { ChiefEngine } from './chief-engine';
import type { WorldManager } from './world-manager';
import type { VillageManager } from './village-manager';

// ---------------------------------------------------------------------------
// 型別定義
// ---------------------------------------------------------------------------

/** 單一 chief 執行錯誤記錄 */
export interface ChiefError {
  chief_id: string;
  village_id: string;
  error: string;
}

/** 一輪 governance cycle 的結果 */
export interface GovernanceCycleResult {
  cycle_id: string;
  started_at: string;
  finished_at: string;
  villages_processed: number;
  total_proposals: number;
  total_applied: number;
  total_rejected: number;
  total_skipped: number;
  chief_results: ChiefCycleResult[];
  errors: ChiefError[];
  skipped?: boolean;
  skip_reason?: string;
}

/** GovernanceScheduler 建構選項 */
export interface GovernanceSchedulerOpts {
  worldManager: WorldManager;
  chiefEngine: ChiefEngine;
  villageManager: VillageManager;
  db: Database;
  /** 排程間隔（ms），預設 60000（CHIEF-02） */
  intervalMs?: number;
  /** 每輪結束後的 callback hook（adapter / summary generator 用） */
  onCycleComplete?: (result: GovernanceCycleResult) => void;
}

// ---------------------------------------------------------------------------
// GovernanceScheduler class
// ---------------------------------------------------------------------------

export class GovernanceScheduler {
  private readonly worldManager: WorldManager;
  private readonly chiefEngine: ChiefEngine;
  private readonly villageManager: VillageManager;
  private readonly db: Database;
  private readonly intervalMs: number;
  private readonly onCycleComplete?: (result: GovernanceCycleResult) => void;

  /** Timer lifecycle 狀態 */
  private _started = false;
  /** 當前是否正在執行 cycle（overlap guard） */
  private _cycling = false;
  /** setInterval handle */
  private _timer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: GovernanceSchedulerOpts) {
    this.worldManager = opts.worldManager;
    this.chiefEngine = opts.chiefEngine;
    this.villageManager = opts.villageManager;
    this.db = opts.db;
    this.intervalMs = opts.intervalMs ?? 60_000;
    this.onCycleComplete = opts.onCycleComplete;
  }

  /** 啟動定時排程。雙重啟動會拋出錯誤。 */
  start(): void {
    if (this._started) {
      throw new Error('GovernanceScheduler is already running');
    }
    this._started = true;
    this._timer = setInterval(() => {
      void this.runOnce().catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'unknown';
        console.error('GovernanceScheduler tick error:', message);
      });
    }, this.intervalMs);
  }

  /** 停止排程。清除 timer，不中斷正在執行的 cycle。 */
  stop(): void {
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._started = false;
  }

  /** 排程是否已啟動 */
  isRunning(): boolean {
    return this._started;
  }

  /**
   * 執行一輪 governance cycle。
   *
   * 流程：
   *   1. Overlap guard — 若上一輪仍在執行，直接 skip
   *   2. 列出所有 active villages
   *   3. 對每個 village，列出 active chiefs 並逐一 executeChiefCycle
   *   4. Per-chief try/catch（error isolation）
   *   5. 彙總結果
   *   6. 寫 audit_log（THY-07）
   *   7. 觸發 onCycleComplete callback
   */
  async runOnce(): Promise<GovernanceCycleResult> {
    // 1. Overlap guard
    if (this._cycling) {
      const now = new Date().toISOString();
      return {
        cycle_id: `cycle-${randomUUID()}`,
        started_at: now,
        finished_at: now,
        villages_processed: 0,
        total_proposals: 0,
        total_applied: 0,
        total_rejected: 0,
        total_skipped: 0,
        chief_results: [],
        errors: [],
        skipped: true,
        skip_reason: 'already_running',
      };
    }

    this._cycling = true;
    const cycleId = `cycle-${randomUUID()}`;
    const startedAt = new Date().toISOString();

    try {
      // 2. 列出所有 active villages
      const villages = this.villageManager.list({ status: 'active' });

      const allChiefResults: ChiefCycleResult[] = [];
      const allErrors: ChiefError[] = [];
      let villagesProcessed = 0;

      // 3. 對每個 village 執行
      for (const village of villages) {
        villagesProcessed++;
        const chiefs = this.chiefEngine.list(village.id, { status: 'active' });

        // 4. Sequential execution per chief with error isolation
        for (const chief of chiefs) {
          try {
            const result = executeChiefCycle(this.worldManager, village.id, chief);
            allChiefResults.push(result);
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'unknown';
            allErrors.push({
              chief_id: chief.id,
              village_id: village.id,
              error: message,
            });
          }
        }
      }

      // 5. 彙總
      const totalProposals = allChiefResults.reduce((sum, r) => sum + r.proposals.length, 0);
      const totalApplied = allChiefResults.reduce((sum, r) => sum + r.applied.length, 0);
      const totalSkipped = allChiefResults.reduce((sum, r) => sum + r.skipped.length, 0);
      const totalRejected = totalProposals - totalApplied - totalSkipped;

      const finishedAt = new Date().toISOString();

      const cycleResult: GovernanceCycleResult = {
        cycle_id: cycleId,
        started_at: startedAt,
        finished_at: finishedAt,
        villages_processed: villagesProcessed,
        total_proposals: totalProposals,
        total_applied: totalApplied,
        total_rejected: Math.max(0, totalRejected),
        total_skipped: totalSkipped,
        chief_results: allChiefResults,
        errors: allErrors,
      };

      // 6. Audit log（THY-07）
      appendAudit(this.db, 'governance', cycleId, 'cycle_complete', {
        villages_processed: villagesProcessed,
        total_proposals: totalProposals,
        total_applied: totalApplied,
        total_skipped: totalSkipped,
        errors: allErrors.length,
      }, 'scheduler');

      // 7. onCycleComplete callback（fire-and-forget）
      if (this.onCycleComplete) {
        try {
          this.onCycleComplete(cycleResult);
        } catch {
          // ADAPTER-01: callback failure 不影響主循環
        }
      }

      return cycleResult;
    } finally {
      this._cycling = false;
    }
  }
}
