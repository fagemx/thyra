/**
 * schemas/observation.ts — ObservationBatch Zod schema
 *
 * 觀察批次的結構化定義。觀察是 canonical cycle 的輸入端：
 * 回答「上次 cycle 以來，世界發生了什麼」，不做判斷。
 *
 * @see docs/plan/world-cycle/TRACK_A_OBSERVATION_BUILDER.md Step 1
 * @see docs/world-design-v0/canonical-cycle.md §4.1
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// ObservationSource — 觀察來源的 5 種類型
// ---------------------------------------------------------------------------

export const ObservationSourceSchema = z.enum([
  'state_diff',
  'audit_log',
  'external',
  'chief_inspection',
  'outcome_followup',
]);
export type ObservationSource = z.infer<typeof ObservationSourceSchema>;

// ---------------------------------------------------------------------------
// Observation Scope — 觀察範圍
// ---------------------------------------------------------------------------

export const ObservationScopeSchema = z.enum([
  'world',
  'zone',
  'stall',
  'event',
  'entry_gate',
  'law',
  'chief',
]);
export type ObservationScope = z.infer<typeof ObservationScopeSchema>;

// ---------------------------------------------------------------------------
// Observation Importance — 重要性等級
// ---------------------------------------------------------------------------

export const ObservationImportanceSchema = z.enum([
  'low',
  'medium',
  'high',
  'critical',
]);
export type ObservationImportance = z.infer<typeof ObservationImportanceSchema>;

// ---------------------------------------------------------------------------
// Observation — 單一觀察項
// ---------------------------------------------------------------------------

export const ObservationSchema = z.object({
  /** 觀察唯一 ID（obs_ 前綴） */
  id: z.string().min(1),

  /** 觀察來源 */
  source: ObservationSourceSchema,

  /** 觀察時間 (ISO 8601) */
  timestamp: z.string().min(1),

  /** 觀察範圍 */
  scope: ObservationScopeSchema,

  /** 重要性等級 */
  importance: ObservationImportanceSchema,

  /** 摘要（人類可讀） */
  summary: z.string().min(1),

  /** 附加細節（結構化資料） */
  details: z.record(z.unknown()).optional(),

  /** 關聯的目標 ID 列表 */
  targetIds: z.array(z.string()).optional(),
});
export type Observation = z.infer<typeof ObservationSchema>;

// ---------------------------------------------------------------------------
// ObservationBatch — 觀察批次
// ---------------------------------------------------------------------------

export const ObservationBatchSchema = z.object({
  /** 批次唯一 ID（obs_batch_ 前綴） */
  id: z.string().min(1),

  /** 所屬 world（village）ID */
  worldId: z.string().min(1),

  /** 所屬 cycle ID（可選，尚未綁定 cycle 時為 undefined） */
  cycleId: z.string().optional(),

  /** 本批次包含的觀察列表 */
  observations: z.array(ObservationSchema),

  /** 批次建立時間 (ISO 8601) */
  createdAt: z.string().min(1),

  /** Schema 版本 */
  version: z.number().default(1),
});
export type ObservationBatch = z.infer<typeof ObservationBatchSchema>;
