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
import { dispatchChiefPipelines, executeCoordinatedCycle, sortChiefsByPriority, type ChiefCycleResult, type PipelineDispatchResult } from './chief-autonomy';
import type { Chief, ChiefEngine } from './chief-engine';
import type { WorldManager } from './world-manager';
import type { VillageManager } from './village-manager';
import {
  type AdapterRegistry,
  type ProcessedHeartbeat,
  createDefaultRegistry,
  buildHeartbeatContext,
  processHeartbeatResult,
} from './execution-adapter';
import type { KarviBridge } from './karvi-bridge';
import type { StaleDetector, StaleCleanupResult } from './stale-detector';
import { CycleTelemetryCollector } from './cycle-telemetry';
import type { CycleTelemetry } from './schemas/cycle-telemetry';

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
  /** Pipeline dispatch 結果（chief 有 pipelines 時） */
  pipeline_dispatches: PipelineDispatchResult[];
  /** Stale cleanup 結果（有 StaleDetector 時） */
  stale_cleanup?: StaleCleanupResult;
  /** Per-chief per-operation telemetry（#232） */
  chief_telemetry: CycleTelemetry[];
  skipped?: boolean;
  skip_reason?: string;
}

/** GovernanceScheduler 建構選項 */
export interface GovernanceSchedulerOpts {
  worldManager: WorldManager;
  chiefEngine: ChiefEngine;
  villageManager: VillageManager;
  db: Database;
  /** Karvi bridge（可選）。有 pipeline 的 chief 需要此 bridge 才能 dispatch。 */
  karviBridge?: KarviBridge;
  /** 排程間隔（ms），預設 60000（CHIEF-02） */
  intervalMs?: number;
  /** 每輪結束後的 callback hook（adapter / summary generator 用） */
  onCycleComplete?: (result: GovernanceCycleResult) => void;
  /** Adapter 註冊表（預設包含 LocalAdapter） */
  adapterRegistry?: AdapterRegistry;
  /** 是否使用 heartbeat protocol 而非直接 executeChiefCycle（預設 false，向後相容） */
  useHeartbeat?: boolean;
  /** Stale detector（可選）。每輪開始前清理超時 chiefs。 */
  staleDetector?: StaleDetector;
}

// ---------------------------------------------------------------------------
// GovernanceScheduler class
// ---------------------------------------------------------------------------

export class GovernanceScheduler {
  private readonly worldManager: WorldManager;
  private readonly chiefEngine: ChiefEngine;
  private readonly villageManager: VillageManager;
  private readonly db: Database;
  private readonly karviBridge: KarviBridge | undefined;
  private readonly intervalMs: number;
  private readonly onCycleComplete?: (result: GovernanceCycleResult) => void;
  private readonly adapterRegistry: AdapterRegistry;
  private readonly useHeartbeat: boolean;
  private readonly staleDetector?: StaleDetector;

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
    this.karviBridge = opts.karviBridge;
    this.intervalMs = opts.intervalMs ?? 60_000;
    this.onCycleComplete = opts.onCycleComplete;
    this.useHeartbeat = opts.useHeartbeat ?? false;
    this.staleDetector = opts.staleDetector;
    this.adapterRegistry = opts.adapterRegistry ?? createDefaultRegistry(
      opts.worldManager,
      (chiefId: string) => opts.chiefEngine.get(chiefId),
      opts.karviBridge,
    );
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
        pipeline_dispatches: [],
        chief_telemetry: [],
        skipped: true,
        skip_reason: 'already_running',
      };
    }

    this._cycling = true;
    const cycleId = `cycle-${randomUUID()}`;
    const startedAt = new Date().toISOString();

    try {
      // 1.5 Pre-cycle stale cleanup (#231)
      let staleCleanup: StaleCleanupResult | undefined;
      if (this.staleDetector) {
        try {
          staleCleanup = await this.staleDetector.cleanup();
        } catch {
          // Stale detection failure does not affect main cycle
        }
      }

      // 2. 列出所有 active villages
      const villages = this.villageManager.list({ status: 'active' });

      const allChiefResults: ChiefCycleResult[] = [];
      const allErrors: ChiefError[] = [];
      const allPipelineDispatches: PipelineDispatchResult[] = [];
      const allTelemetry: CycleTelemetry[] = [];
      let villagesProcessed = 0;

      // 3. 對每個 village 執行
      for (const village of villages) {
        villagesProcessed++;
        const chiefs = this.chiefEngine.listTopLevel(village.id, { status: 'active' });

        // 4. Separate pipeline chiefs from local chiefs
        const pipelineChiefs = chiefs.filter(c => c.pipelines.length > 0);
        const localChiefs = chiefs.filter(c => c.pipelines.length === 0);

        // 4a. Pipeline chiefs: dispatch to Karvi (async, unordered) with telemetry
        for (const chief of pipelineChiefs) {
          const ops = CycleTelemetryCollector.begin(cycleId, chief.id, village.id);
          // Run tracking: mark chief as running before execution (#231)
          const runId = `run-${randomUUID()}`;
          this.chiefEngine.markRunning(chief.id, runId);

          try {
            if (this.karviBridge) {
              ops.start('dispatch_pipeline');
              const dispatches = await dispatchChiefPipelines(this.karviBridge, village.id, chief);
              ops.end('dispatch_pipeline', 'ok');
              allPipelineDispatches.push(...dispatches);

              appendAudit(this.db, 'governance', cycleId, 'pipeline_dispatch', {
                chief_id: chief.id,
                village_id: village.id,
                pipelines: chief.pipelines,
                dispatched_count: dispatches.filter(d => d.dispatched).length,
                failed_count: dispatches.filter(d => !d.dispatched).length,
              }, 'scheduler');
            } else {
              ops.start('dispatch_pipeline');
              ops.end('dispatch_pipeline', 'skipped', { detail: 'no_karvi_bridge' });

              appendAudit(this.db, 'governance', cycleId, 'pipeline_skip', {
                chief_id: chief.id,
                village_id: village.id,
                reason: 'no_karvi_bridge',
                pipelines: chief.pipelines,
              }, 'scheduler');
            }
            // Run tracking: mark chief as idle after successful execution (#231)
            this.chiefEngine.markIdle(chief.id);
          } catch (err: unknown) {
            // Run tracking: mark chief as idle on error too (so it can retry next cycle)
            this.chiefEngine.markIdle(chief.id);
            const message = err instanceof Error ? err.message : 'unknown';
            allErrors.push({
              chief_id: chief.id,
              village_id: village.id,
              error: message,
            });
          }

          // 儲存 telemetry（即使有 error 也要記錄部分 timing）
          const telemetry = ops.finish();
          allTelemetry.push(telemetry);
          CycleTelemetryCollector.save(this.db, telemetry);
        }

        // 4b. Local chiefs: coordinated execution with priority ordering + state threading
        if (localChiefs.length > 0) {
          if (this.useHeartbeat) {
            await this.runHeartbeatPath(village.id, localChiefs, cycleId, allChiefResults, allErrors, allTelemetry);
          } else {
            this.runCoordinatedPath(village.id, localChiefs, cycleId, allChiefResults, allErrors, allTelemetry);
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
        pipeline_dispatches: allPipelineDispatches,
        stale_cleanup: staleCleanup,
        chief_telemetry: allTelemetry,
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

  /**
   * Heartbeat path: sort by priority, sequential execution with state threading.
   * Each chief sees the accumulated state from higher-priority chiefs.
   */
  private async runHeartbeatPath(
    villageId: string,
    localChiefs: Chief[],
    cycleId: string,
    allChiefResults: ChiefCycleResult[],
    allErrors: ChiefError[],
    allTelemetry: CycleTelemetry[],
  ): Promise<void> {
    const sorted = sortChiefsByPriority(localChiefs);
    let currentState = this.worldManager.getState(villageId);
    for (const chief of sorted) {
      const ops = CycleTelemetryCollector.begin(cycleId, chief.id, villageId);
      try {
        ops.start('build_context');
        const adapter = this.adapterRegistry.get(chief.adapter_type);
        const context = buildHeartbeatContext(chief, currentState, 'scheduled');
        ops.end('build_context', 'ok');

        ops.start('invoke_adapter');
        const hbResult = await adapter.invoke(context);
        ops.end('invoke_adapter', 'ok');

        ops.start('process_result');
        const processed = processHeartbeatResult(
          this.worldManager, this.db, villageId, chief, hbResult,
        );
        ops.end('process_result', 'ok');

        allChiefResults.push(this.toChiefCycleResult(chief.id, processed));
        // Thread state: use last successful apply's state_after
        for (const applied of processed.applied) {
          if (applied.state_after) {
            currentState = applied.state_after;
          }
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'unknown';
        allErrors.push({
          chief_id: chief.id,
          village_id: villageId,
          error: message,
        });
      }
      const telemetry = ops.finish();
      allTelemetry.push(telemetry);
      CycleTelemetryCollector.save(this.db, telemetry);
    }
  }

  /**
   * Coordinated cycle path: priority ordering + state threading + per-chief isolation.
   * Falls back to tagging all local chiefs on catastrophic error (e.g. getState failure).
   */
  private runCoordinatedPath(
    villageId: string,
    localChiefs: Chief[],
    cycleId: string,
    allChiefResults: ChiefCycleResult[],
    allErrors: ChiefError[],
    allTelemetry: CycleTelemetry[],
  ): void {
    // Telemetry: one session per chief in the coordinated cycle
    const chiefOps = localChiefs.map(chief =>
      ({ chief, ops: CycleTelemetryCollector.begin(cycleId, chief.id, villageId) }),
    );
    try {
      // Start timing for all chiefs (coordinated execution is atomic per village)
      for (const { ops } of chiefOps) {
        ops.start('decide');
      }
      const coordResult = executeCoordinatedCycle(this.worldManager, villageId, localChiefs);
      // End timing for each chief based on coordinated results
      for (let i = 0; i < chiefOps.length; i++) {
        const { ops } = chiefOps[i];
        const chiefResult = coordResult.chief_results[i];
        const hadError = coordResult.errors.some(e => e.chief_id === chiefResult?.chief_id);
        ops.end('decide', hadError ? 'error' : 'ok');
      }
      allChiefResults.push(...coordResult.chief_results);
      // Propagate per-chief errors from coordinated cycle
      for (const err of coordResult.errors) {
        allErrors.push({
          chief_id: err.chief_id,
          village_id: villageId,
          error: err.error,
        });
      }
    } catch (err: unknown) {
      // Catastrophic error (e.g. getState fails for entire village) — tag all local chiefs
      const message = err instanceof Error ? err.message : 'unknown';
      for (const { chief, ops } of chiefOps) {
        ops.end('decide', 'error', { detail: message });
        allErrors.push({
          chief_id: chief.id,
          village_id: villageId,
          error: message,
        });
      }
    }
    // Save telemetry for all local chiefs
    for (const { ops } of chiefOps) {
      const telemetry = ops.finish();
      allTelemetry.push(telemetry);
      CycleTelemetryCollector.save(this.db, telemetry);
    }
  }

  /**
   * 將 ProcessedHeartbeat 映射為 ChiefCycleResult，維持向後相容。
   * heartbeat protocol 不產生 ChiefProposal 物件，
   * 所以 proposals/skipped 欄位為空，改用 applied 追蹤。
   */
  private toChiefCycleResult(chiefId: string, processed: ProcessedHeartbeat): ChiefCycleResult {
    return {
      chief_id: chiefId,
      proposals: [],    // heartbeat path 不暴露原始 proposals
      applied: processed.applied,
      skipped: [],      // rejection 計入 rejected_count
    };
  }
}
