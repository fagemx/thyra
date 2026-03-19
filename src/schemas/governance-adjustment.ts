/**
 * schemas/governance-adjustment.ts — GovernanceAdjustment Zod schema
 *
 * 治理調整記錄。當 OutcomeReport 判定為有害或需要回調/微調時，
 * 產生一筆 GovernanceAdjustment 描述應調整的治理參數。
 *
 * CONTRACT: ADJ-01 — target + before/after 必填
 * CONTRACT: ADJ-02 — 只在 verdict=harmful 或 recommendation=rollback/retune 時觸發
 * CONTRACT: THY-04 — id, created_at (createdAt), version
 *
 * @see docs/world-design-v0/shared-types.md §6.11
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// AdjustmentType — 可調整的治理面向
// ---------------------------------------------------------------------------

export const AdjustmentTypeSchema = z.enum([
  'law_threshold',
  'chief_permission',
  'chief_style',
  'risk_policy',
  'simulation_policy',
]);
export type AdjustmentType = z.infer<typeof AdjustmentTypeSchema>;

// ---------------------------------------------------------------------------
// AdjustmentStatus — 調整的生命週期狀態
// ---------------------------------------------------------------------------

export const AdjustmentStatusSchema = z.enum([
  'proposed',
  'approved',
  'applied',
  'rejected',
]);
export type AdjustmentStatus = z.infer<typeof AdjustmentStatusSchema>;

// ---------------------------------------------------------------------------
// GovernanceAdjustment — 完整調整記錄
// ---------------------------------------------------------------------------

export const GovernanceAdjustmentSchema = z.object({
  id: z.string(),
  worldId: z.string(),
  triggeredBy: z.string(), // outcomeReportId or precedentId

  adjustmentType: AdjustmentTypeSchema,
  target: z.string(),      // ADJ-01: what law/chief/policy is being adjusted
  before: z.string(),      // ADJ-01: 調整前的值
  after: z.string(),       // ADJ-01: 調整後的值
  rationale: z.string(),

  status: AdjustmentStatusSchema,
  createdAt: z.string(),
  version: z.number().int().default(1),
});
export type GovernanceAdjustment = z.infer<typeof GovernanceAdjustmentSchema>;
