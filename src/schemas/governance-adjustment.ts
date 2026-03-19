/**
 * schemas/governance-adjustment.ts — GovernanceAdjustment Zod schemas
 *
 * 定義 governance adjustment 的型別：
 * - AdjustmentType: 調整類型（law_threshold, chief_permission 等）
 * - AdjustmentStatus: 調整狀態（proposed, approved, applied, rejected）
 * - GovernanceAdjustment: 完整的治理調整記錄
 *
 * CONTRACT: ADJ-01 — Adjustment must specify target + before/after
 * CONTRACT: ADJ-02 — Adjustment only fires on harmful/rollback/retune
 *
 * @see docs/plan/world-cycle/TRACK_G_GOVERNANCE_ADJUSTMENT.md Step 1
 * @see docs/world-design-v0/shared-types.md §6.11
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// AdjustmentType — 調整類型
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
// AdjustmentStatus — 調整狀態
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
  target: z.string().min(1),      // ADJ-01: what law/chief/policy is being adjusted
  before: z.string(),             // ADJ-01: current value
  after: z.string(),              // ADJ-01: proposed value
  rationale: z.string().min(1),

  status: AdjustmentStatusSchema,
  createdAt: z.string(),
  version: z.number().int().min(1).default(1),
});
export type GovernanceAdjustment = z.infer<typeof GovernanceAdjustmentSchema>;

// ---------------------------------------------------------------------------
// CreateAdjustmentInput — 建立調整的輸入
// ---------------------------------------------------------------------------

export const CreateAdjustmentInputSchema = z.object({
  worldId: z.string(),
  triggeredBy: z.string(),
  adjustmentType: AdjustmentTypeSchema,
  target: z.string().min(1),   // ADJ-01: must specify target
  before: z.string(),          // ADJ-01: must specify before
  after: z.string(),           // ADJ-01: must specify after
  rationale: z.string().min(1),
});
export type CreateAdjustmentInput = z.infer<typeof CreateAdjustmentInputSchema>;
