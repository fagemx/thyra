/**
 * world.ts — World API route-level input schemas。
 *
 * 包裝 WorldChangeSchema 為各 route endpoint 提供驗證。
 */
import { z } from 'zod';
import { WorldChangeSchema } from './world-change';

// ---------------------------------------------------------------------------
// Route input schemas
// ---------------------------------------------------------------------------

/** POST /world/:village_id/judge — 評估變更是否合法 */
export const JudgeChangeInput = z.object({
  change: WorldChangeSchema,
});

/** POST /world/:village_id/apply — 套用變更到世界狀態 */
export const ApplyChangeInput = z.object({
  change: WorldChangeSchema,
  reason: z.string().optional(),
});

/** POST /world/:village_id/rollback — 回滾到指定快照 */
export const RollbackInput = z.object({
  snapshot_id: z.string().min(1),
  reason: z.string().min(1),
});

/** POST /world/:village_id/snapshot — 手動建立快照 */
export const SnapshotInput = z.object({
  trigger: z.enum(['manual']).default('manual'),
});

/** GET /world/:village_id/continuity — 取得連續性報告 */
export const ContinuityInput = z.object({
  cycle_count: z.number().int().min(1).default(100),
});

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type JudgeChangeInput = z.infer<typeof JudgeChangeInput>;
export type ApplyChangeInput = z.infer<typeof ApplyChangeInput>;
export type RollbackInput = z.infer<typeof RollbackInput>;
export type SnapshotInput = z.infer<typeof SnapshotInput>;
export type ContinuityInput = z.infer<typeof ContinuityInput>;
