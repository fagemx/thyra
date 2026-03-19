/**
 * schemas/cycle-run.ts — CycleRun Zod schema
 *
 * Canonical cycle 的執行記錄。每次 cycle 產生一個 CycleRun artifact，
 * 記錄所有 stage 的 timestamp 和產出物 ID。
 *
 * @see docs/plan/world-cycle/TRACK_C_CYCLE_RUNNER.md Step 1
 * @see docs/plan/world-cycle/CONTRACT.md CYCLE-01, CYCLE-02
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// CycleStage — 10 stages + failed terminal state
// ---------------------------------------------------------------------------

export const CycleStageSchema = z.enum([
  'idle',
  'observe',
  'propose',
  'judge',
  'apply',
  'pulse',
  'outcome',
  'precedent',
  'adjust',
  'complete',
  'failed',
]);
export type CycleStage = z.infer<typeof CycleStageSchema>;

// ---------------------------------------------------------------------------
// CycleRun — 完整 cycle 執行記錄 (CYCLE-02)
// ---------------------------------------------------------------------------

export const CycleRunSchema = z.object({
  id: z.string(),
  worldId: z.string(),
  cycleNumber: z.number(),
  currentStage: CycleStageSchema,

  // Stage timestamps — null until that stage starts/completes
  observeStartedAt: z.string().nullable(),
  observeCompletedAt: z.string().nullable(),
  proposeStartedAt: z.string().nullable(),
  proposeCompletedAt: z.string().nullable(),
  judgeStartedAt: z.string().nullable(),
  judgeCompletedAt: z.string().nullable(),
  applyStartedAt: z.string().nullable(),
  applyCompletedAt: z.string().nullable(),
  pulseStartedAt: z.string().nullable(),
  pulseCompletedAt: z.string().nullable(),
  outcomeStartedAt: z.string().nullable(),
  outcomeCompletedAt: z.string().nullable(),
  precedentStartedAt: z.string().nullable(),
  precedentCompletedAt: z.string().nullable(),
  adjustStartedAt: z.string().nullable(),
  adjustCompletedAt: z.string().nullable(),

  // Metadata
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  failedAt: z.string().nullable(),
  failedStage: CycleStageSchema.nullable(),
  failureReason: z.string().nullable(),

  // Artifact references
  observationBatchId: z.string().nullable(),
  proposalIds: z.array(z.string()),
  judgmentReportIds: z.array(z.string()),
  appliedChangeIds: z.array(z.string()),
  pulseFrameId: z.string().nullable(),

  // THY-04: id, created_at, version
  created_at: z.string(),
  version: z.number().default(1),
});
export type CycleRun = z.infer<typeof CycleRunSchema>;
