/**
 * cycle-runner.ts — 10-stage canonical cycle orchestrator
 *
 * Runs the full canonical cycle in fixed stage order (CYCLE-01),
 * recording timestamps and artifact IDs in a CycleRun (CYCLE-02).
 *
 * @see docs/plan/world-cycle/TRACK_C_CYCLE_RUNNER.md Step 2
 * @see docs/plan/world-cycle/CONTRACT.md CYCLE-01, CYCLE-02
 */

import type { Database } from '../db';
import type { WorldState } from '../world/state';
import type { ObservationBatch } from '../schemas/observation';
import type { CanonicalChangeProposal } from '../schemas/canonical-proposal';
import type { CycleRun, CycleStage } from '../schemas/cycle-run';

import { advanceCycleStage, failCycleAtStage } from './cycle-state-machine';

// ---------------------------------------------------------------------------
// Placeholder result types for downstream tracks
// ---------------------------------------------------------------------------

export interface JudgmentResult {
  proposalId: string;
  approved: boolean;
  reportId: string;
  reason: string;
}

export interface ApplyResult {
  proposalId: string;
  changeId: string;
  applied: boolean;
}

export interface PulseResult {
  pulseFrameId: string;
}

export interface OutcomeResult {
  appliedChangeIds: string[];
  summary: string;
}

export interface PrecedentResult {
  recorded: boolean;
  precedentId: string | null;
}

export interface AdjustResult {
  adjusted: boolean;
  adjustments: string[];
}

// ---------------------------------------------------------------------------
// CycleStageHandlers — DI interface for stage implementations
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
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return `cr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function now(): string {
  return new Date().toISOString();
}

/**
 * Get next cycle number for a world (auto-increment).
 */
function getNextCycleNumber(db: Database, worldId: string): number {
  const row = db.prepare(
    'SELECT MAX(cycle_number) as max_num FROM cycle_runs WHERE world_id = ?'
  ).get(worldId) as { max_num: number | null } | null;
  return (row?.max_num ?? 0) + 1;
}

/**
 * Create initial CycleRun with idle stage and all nulls.
 */
function createInitialCycleRun(id: string, worldId: string, cycleNumber: number): CycleRun {
  const timestamp = now();
  return {
    id,
    worldId,
    cycleNumber,
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
    startedAt: timestamp,
    completedAt: null,
    failedAt: null,
    failedStage: null,
    failureReason: null,
    observationBatchId: null,
    proposalIds: [],
    judgmentReportIds: [],
    appliedChangeIds: [],
    pulseFrameId: null,
    created_at: timestamp,
    version: 1,
  };
}

/**
 * Set a stage start or complete timestamp on the CycleRun.
 * Uses a mapped key approach: stage + "StartedAt" / "CompletedAt".
 */
function setStageTimestamp(
  run: CycleRun,
  stage: CycleStage,
  phase: 'started' | 'completed',
): CycleRun {
  const suffix = phase === 'started' ? 'StartedAt' : 'CompletedAt';
  const key = `${stage}${suffix}` as keyof CycleRun;
  return { ...run, [key]: now() } as CycleRun;
}

/**
 * Persist CycleRun to SQLite (INSERT OR REPLACE).
 * Maps camelCase fields to snake_case columns.
 */
function saveCycleRun(db: Database, run: CycleRun): void {
  db.prepare(`
    INSERT OR REPLACE INTO cycle_runs (
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
    )
  `).run(
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
    run.observationBatchId,
    JSON.stringify(run.proposalIds),
    JSON.stringify(run.judgmentReportIds),
    JSON.stringify(run.appliedChangeIds),
    run.pulseFrameId,
    run.created_at, run.version,
  );
}

// ---------------------------------------------------------------------------
// orchestrateCycle — main entry point
// ---------------------------------------------------------------------------

/**
 * Run one full canonical cycle for a world.
 *
 * Stages execute in fixed order (CYCLE-01):
 *   idle → observe → propose → judge → apply → pulse → outcome → precedent → adjust → complete
 *
 * Each stage handler is injected via `handlers` for testability (DI).
 * Failures at any stage mark the cycle as `failed` with the failing stage recorded.
 */
export async function orchestrateCycle(
  db: Database,
  worldId: string,
  currentState: WorldState,
  handlers: CycleStageHandlers,
): Promise<CycleRun> {
  const id = generateId();
  const cycleNumber = getNextCycleNumber(db, worldId);
  let run = createInitialCycleRun(id, worldId, cycleNumber);

  // Save initial state
  saveCycleRun(db, run);

  try {
    // --- Stage 1: observe ---
    run = { ...run, currentStage: advanceCycleStage(run.currentStage, 'observe') };
    run = setStageTimestamp(run, 'observe', 'started');
    const batch = await handlers.observe(worldId, currentState);
    run = setStageTimestamp(run, 'observe', 'completed');
    run = { ...run, observationBatchId: batch.id };
    saveCycleRun(db, run);

    // --- Stage 2: propose ---
    run = { ...run, currentStage: advanceCycleStage(run.currentStage, 'propose') };
    run = setStageTimestamp(run, 'propose', 'started');
    const proposals = await handlers.propose(worldId, batch);
    run = setStageTimestamp(run, 'propose', 'completed');
    run = { ...run, proposalIds: proposals.map(p => p.id) };
    saveCycleRun(db, run);

    // --- Stage 3: judge ---
    run = { ...run, currentStage: advanceCycleStage(run.currentStage, 'judge') };
    run = setStageTimestamp(run, 'judge', 'started');
    const judgments = await handlers.judge(worldId, proposals);
    run = setStageTimestamp(run, 'judge', 'completed');
    run = { ...run, judgmentReportIds: judgments.map(j => j.reportId) };
    saveCycleRun(db, run);

    // --- Filter approved proposals for apply stage ---
    const approvedIds = new Set(
      judgments.filter(j => j.approved).map(j => j.proposalId),
    );
    const approvedProposals = proposals.filter(p => approvedIds.has(p.id));

    // --- Stage 4: apply ---
    run = { ...run, currentStage: advanceCycleStage(run.currentStage, 'apply') };
    run = setStageTimestamp(run, 'apply', 'started');
    const applyResults = await handlers.apply(worldId, approvedProposals);
    run = setStageTimestamp(run, 'apply', 'completed');
    run = { ...run, appliedChangeIds: applyResults.filter(r => r.applied).map(r => r.changeId) };
    saveCycleRun(db, run);

    // --- Stage 5: pulse ---
    run = { ...run, currentStage: advanceCycleStage(run.currentStage, 'pulse') };
    run = setStageTimestamp(run, 'pulse', 'started');
    const pulseResult = await handlers.pulse(worldId);
    run = setStageTimestamp(run, 'pulse', 'completed');
    run = { ...run, pulseFrameId: pulseResult.pulseFrameId };
    saveCycleRun(db, run);

    // --- Stage 6: outcome ---
    run = { ...run, currentStage: advanceCycleStage(run.currentStage, 'outcome') };
    run = setStageTimestamp(run, 'outcome', 'started');
    const outcomeResult = await handlers.outcome(worldId, run.appliedChangeIds);
    run = setStageTimestamp(run, 'outcome', 'completed');
    saveCycleRun(db, run);

    // --- Stage 7: precedent ---
    run = { ...run, currentStage: advanceCycleStage(run.currentStage, 'precedent') };
    run = setStageTimestamp(run, 'precedent', 'started');
    await handlers.precedent(worldId, outcomeResult);
    run = setStageTimestamp(run, 'precedent', 'completed');
    saveCycleRun(db, run);

    // --- Stage 8: adjust ---
    run = { ...run, currentStage: advanceCycleStage(run.currentStage, 'adjust') };
    run = setStageTimestamp(run, 'adjust', 'started');
    await handlers.adjust(worldId, outcomeResult);
    run = setStageTimestamp(run, 'adjust', 'completed');
    saveCycleRun(db, run);

    // --- Complete ---
    run = { ...run, currentStage: advanceCycleStage(run.currentStage, 'complete') };
    run = { ...run, completedAt: now() };
    saveCycleRun(db, run);

    return run;
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    const failure = failCycleAtStage(run.currentStage, reason);
    run = {
      ...run,
      currentStage: failure.stage,
      failedStage: failure.failedStage,
      failureReason: failure.reason,
      failedAt: now(),
    };
    saveCycleRun(db, run);
    return run;
  }
}
