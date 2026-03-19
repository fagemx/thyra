/**
 * cycle-runner.ts — 10-stage cycle orchestrator
 *
 * 編排一次完整的治理循環，依序執行 10 個 stage（CYCLE-01）。
 * Stage handlers 透過 DI 注入，方便測試時替換為 noop。
 *
 * @see docs/plan/world-cycle/TRACK_C_CYCLE_RUNNER.md Step 2
 * @see docs/plan/world-cycle/CONTRACT.md CYCLE-01, CYCLE-02
 */

import type { CycleRun, CycleStage } from '../schemas/cycle-run';
import type { WorldState } from '../world/state';
import type { ObservationBatch } from '../schemas/observation';
import type { CanonicalChangeProposal } from '../schemas/canonical-proposal';
import { advanceCycleStage, failCycleAtStage } from './cycle-state-machine';

// ---------------------------------------------------------------------------
// Placeholder result types — 在下游 Track 實作後替換為真實型別
// JudgmentResult → JudgeResult (from src/world/judge.ts)
// PulseResult → PulseFrame (from shared-types.md §6.8)
// OutcomeResult → OutcomeReport (from shared-types.md §6.9)
// PrecedentResult → PrecedentRecord (from shared-types.md §6.10)
// AdjustResult → GovernanceAdjustment (from shared-types.md §6.11)
// ---------------------------------------------------------------------------

export interface JudgmentResult {
  proposalId: string;
  approved: boolean;
}

export interface ApplyResult {
  proposalId: string;
  appliedChangeId: string;
}

export interface PulseResult {
  pulseFrameId: string;
}

export interface OutcomeResult {
  outcomeReportIds: string[];
}

export interface PrecedentResult {
  precedentIds: string[];
}

export interface AdjustResult {
  adjustmentIds: string[];
}

// ---------------------------------------------------------------------------
// Stage handler interfaces — DI 注入用
// ---------------------------------------------------------------------------

export interface CycleStageHandlers {
  observe: (worldId: string, currentState: WorldState) => Promise<ObservationBatch>;
  propose: (worldId: string, observations: ObservationBatch) => Promise<CanonicalChangeProposal[]>;
  judge: (worldId: string, proposals: CanonicalChangeProposal[]) => Promise<JudgmentResult[]>;
  apply: (worldId: string, approved: CanonicalChangeProposal[]) => Promise<ApplyResult[]>;
  pulse: (worldId: string) => Promise<PulseResult>;
  outcome: (worldId: string, appliedIds: string[]) => Promise<OutcomeResult>;
  precedent: (worldId: string, outcomes: OutcomeResult) => Promise<PrecedentResult>;
  adjust: (worldId: string, outcomes: OutcomeResult) => Promise<AdjustResult>;
}

// ---------------------------------------------------------------------------
// Persistence helper types
// ---------------------------------------------------------------------------

/** 最小 DB 介面 — 只需 run()，方便測試注入 */
export interface CycleRunDb {
  run(sql: string, params: unknown[]): void;
}

// ---------------------------------------------------------------------------
// orchestrateCycle — 主入口
// ---------------------------------------------------------------------------

/**
 * Orchestrate one complete governance cycle.
 *
 * Runs all 10 stages in fixed order (CYCLE-01).
 * If any stage fails, marks the cycle as failed with the stage name and reason.
 * CycleRun is persisted after every stage transition (CYCLE-02).
 */
export async function orchestrateCycle(
  db: CycleRunDb,
  worldId: string,
  currentState: WorldState,
  handlers: CycleStageHandlers,
): Promise<CycleRun> {
  const cycleId = `cycle_${worldId}_${Date.now()}`;
  const now = new Date().toISOString();

  const run: CycleRun = createInitialCycleRun(cycleId, worldId, now);
  saveCycleRun(db, run);

  // 中間結果，跨 stage 傳遞
  let observationBatch: ObservationBatch | null = null;
  let proposals: CanonicalChangeProposal[] = [];
  let judgments: JudgmentResult[] = [];
  let outcomeResult: OutcomeResult | null = null;

  const stages: Array<{
    name: CycleStage;
    execute: () => Promise<void>;
  }> = [
    {
      name: 'observe',
      execute: async () => {
        observationBatch = await handlers.observe(worldId, currentState);
        run.observationBatchId = observationBatch.id;
      },
    },
    {
      name: 'propose',
      execute: async () => {
        if (!observationBatch) throw new Error('No observation batch available');
        proposals = await handlers.propose(worldId, observationBatch);
        run.proposalIds = proposals.map(p => p.id);
      },
    },
    {
      name: 'judge',
      execute: async () => {
        judgments = await handlers.judge(worldId, proposals);
        run.judgmentReportIds = judgments.map(r => r.proposalId);
      },
    },
    {
      name: 'apply',
      execute: async () => {
        const approved = proposals.filter(p =>
          judgments.some(j => j.proposalId === p.id && j.approved),
        );
        const results = await handlers.apply(worldId, approved);
        run.appliedChangeIds = results.map(r => r.appliedChangeId);
      },
    },
    {
      name: 'pulse',
      execute: async () => {
        const result = await handlers.pulse(worldId);
        run.pulseFrameId = result.pulseFrameId;
      },
    },
    {
      name: 'outcome',
      execute: async () => {
        outcomeResult = await handlers.outcome(worldId, run.appliedChangeIds);
      },
    },
    {
      name: 'precedent',
      execute: async () => {
        if (!outcomeResult) throw new Error('No outcome result available');
        await handlers.precedent(worldId, outcomeResult);
      },
    },
    {
      name: 'adjust',
      execute: async () => {
        if (!outcomeResult) throw new Error('No outcome result available');
        await handlers.adjust(worldId, outcomeResult);
      },
    },
  ];

  for (const stage of stages) {
    try {
      run.currentStage = advanceCycleStage(run.currentStage, stage.name);
      setStageTimestamp(run, stage.name, 'start');
      saveCycleRun(db, run);

      await stage.execute();

      setStageTimestamp(run, stage.name, 'complete');
      saveCycleRun(db, run);
    } catch (err) {
      const failure = failCycleAtStage(stage.name, String(err));
      run.currentStage = 'failed';
      run.failedStage = failure.failedStage;
      run.failureReason = failure.reason;
      run.failedAt = new Date().toISOString();
      saveCycleRun(db, run);
      return run;
    }
  }

  // All 8 active stages completed → advance to 'complete'
  run.currentStage = advanceCycleStage(run.currentStage, 'complete');
  run.completedAt = new Date().toISOString();
  saveCycleRun(db, run);

  return run;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function createInitialCycleRun(id: string, worldId: string, now: string): CycleRun {
  return {
    id,
    worldId,
    cycleNumber: 0, // Caller should set from DB sequence
    currentStage: 'idle',
    observeStartedAt: null,
    observeCompletedAt: null,
    proposeStartedAt: null,
    proposeCompletedAt: null,
    judgeStartedAt: null,
    judgeCompletedAt: null,
    applyStartedAt: null,
    applyCompletedAt: null,
    pulseStartedAt: null,
    pulseCompletedAt: null,
    outcomeStartedAt: null,
    outcomeCompletedAt: null,
    precedentStartedAt: null,
    precedentCompletedAt: null,
    adjustStartedAt: null,
    adjustCompletedAt: null,
    startedAt: now,
    completedAt: null,
    failedAt: null,
    failedStage: null,
    failureReason: null,
    observationBatchId: null,
    proposalIds: [],
    judgmentReportIds: [],
    appliedChangeIds: [],
    pulseFrameId: null,
    created_at: now,
    version: 1,
  };
}

/**
 * Set start or complete timestamp for a given stage on the CycleRun.
 * Uses dynamic key construction matching the CycleRun schema field names.
 */
function setStageTimestamp(
  run: CycleRun,
  stage: CycleStage,
  phase: 'start' | 'complete',
): void {
  const suffix = phase === 'start' ? 'StartedAt' : 'CompletedAt';
  const key = `${stage}${suffix}` as keyof CycleRun;
  // Stage timestamp fields are always string | null on CycleRun
  (run as Record<string, unknown>)[key] = new Date().toISOString();
}

/**
 * Persist the CycleRun to SQLite (INSERT OR REPLACE).
 * Stores stage timestamps + all artifact IDs.
 */
function saveCycleRun(db: CycleRunDb, run: CycleRun): void {
  db.run(
    `INSERT OR REPLACE INTO cycle_runs (
      id, world_id, cycle_number, current_stage,
      observe_started_at, observe_completed_at,
      propose_started_at, propose_completed_at,
      judge_started_at, judge_completed_at,
      apply_started_at, apply_completed_at,
      pulse_started_at, pulse_completed_at,
      outcome_started_at, outcome_completed_at,
      precedent_started_at, precedent_completed_at,
      adjust_started_at, adjust_completed_at,
      started_at, completed_at, failed_at, failed_stage, failure_reason,
      observation_batch_id, proposal_ids, judgment_report_ids,
      applied_change_ids, pulse_frame_id,
      created_at, version
    ) VALUES (
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?
    )`,
    [
      run.id, run.worldId, run.cycleNumber, run.currentStage,
      run.observeStartedAt, run.observeCompletedAt,
      run.proposeStartedAt, run.proposeCompletedAt,
      run.judgeStartedAt, run.judgeCompletedAt,
      run.applyStartedAt, run.applyCompletedAt,
      run.pulseStartedAt, run.pulseCompletedAt,
      run.outcomeStartedAt, run.outcomeCompletedAt,
      run.precedentStartedAt, run.precedentCompletedAt,
      run.adjustStartedAt, run.adjustCompletedAt,
      run.startedAt, run.completedAt, run.failedAt, run.failedStage, run.failureReason,
      run.observationBatchId, JSON.stringify(run.proposalIds), JSON.stringify(run.judgmentReportIds),
      JSON.stringify(run.appliedChangeIds), run.pulseFrameId,
      run.created_at, run.version,
    ],
  );
}
