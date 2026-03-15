/**
 * World API 路由的輸入驗證 schemas。
 *
 * 供 routes/world.ts 使用，確保 API 輸入符合 THY-11 規範。
 */
import { z } from 'zod';
import { WorldChangeSchema } from './world-change';

export const JudgeChangeInput = z.object({
  change: WorldChangeSchema,
});

export const ApplyChangeInput = z.object({
  change: WorldChangeSchema,
  reason: z.string().optional(),
});

export const RollbackInput = z.object({
  snapshot_id: z.string().min(1),
  reason: z.string().min(1),
});

export const SnapshotInput = z.object({
  trigger: z.enum(['manual']).default('manual'),
});

export const ContinuityInput = z.object({
  cycle_count: z.number().int().min(1).default(100),
});

export type JudgeChangeInput = z.infer<typeof JudgeChangeInput>;
export type ApplyChangeInput = z.infer<typeof ApplyChangeInput>;
export type RollbackInput = z.infer<typeof RollbackInput>;
export type SnapshotInput = z.infer<typeof SnapshotInput>;
export type ContinuityInput = z.infer<typeof ContinuityInput>;
