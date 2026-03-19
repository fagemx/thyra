/**
 * schemas/outcome-window.ts — OutcomeWindow Zod schema
 *
 * OutcomeWindow 追蹤 change apply 後的 metric deltas。
 * 有明確的 open/close lifecycle（CONTRACT OUTCOME-01）。
 *
 * @see docs/plan/world-cycle/TRACK_E_OUTCOME_COLLECTOR.md Step 1
 * @see docs/plan/world-cycle/CONTRACT.md OUTCOME-01
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// OutcomeWindowStatus — 三態狀態機
// ---------------------------------------------------------------------------

export const OutcomeWindowStatusSchema = z.enum(['open', 'evaluating', 'closed']);
export type OutcomeWindowStatus = z.infer<typeof OutcomeWindowStatusSchema>;

// ---------------------------------------------------------------------------
// OutcomeWindow — 完整 window 記錄
// ---------------------------------------------------------------------------

export const OutcomeWindowSchema = z.object({
  id: z.string(),
  worldId: z.string(),
  appliedChangeId: z.string(),
  proposalId: z.string(),
  cycleId: z.string(),
  status: OutcomeWindowStatusSchema,
  baselineSnapshot: z.record(z.string(), z.number()), // metric name -> baseline value
  openedAt: z.string(),
  evaluatedAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  version: z.number().int().min(1),
  createdAt: z.string(),
});
export type OutcomeWindow = z.infer<typeof OutcomeWindowSchema>;

// ---------------------------------------------------------------------------
// CreateOutcomeWindowInput — 建立時輸入
// ---------------------------------------------------------------------------

export const CreateOutcomeWindowInputSchema = z.object({
  worldId: z.string().min(1),
  appliedChangeId: z.string().min(1),
  proposalId: z.string().min(1),
  cycleId: z.string().min(1),
  baselineSnapshot: z.record(z.string(), z.number()),
});
export type CreateOutcomeWindowInput = z.infer<typeof CreateOutcomeWindowInputSchema>;
