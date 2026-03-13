import { z } from 'zod';

/**
 * 固定評分權重 — 人類設定，AI 不可修改 (THY-12 alignment)
 * 所有權重加總 = 1.0
 */
export const DEFAULT_WEIGHTS = {
  completion_rate: 0.30,
  review_pass_rate: 0.25,
  rollback_rate: 0.20,
  budget_efficiency: 0.15,
  edda_reuse_rate: 0.10,
} as const;

export const KPI_NAMES = [
  'completion_rate',
  'review_pass_rate',
  'rollback_rate',
  'budget_efficiency',
  'edda_reuse_rate',
] as const;

export type KpiName = (typeof KPI_NAMES)[number];

export const VillageKpisSchema = z.object({
  completion_rate: z.number().min(0).max(1),
  review_pass_rate: z.number().min(0).max(1),
  rollback_rate: z.number().min(0).max(1),
  budget_efficiency: z.number().min(0).max(1),
  edda_reuse_rate: z.number().min(0).max(1),
});
export type VillageKpis = z.infer<typeof VillageKpisSchema>;

export const VillageScoreSchema = z.object({
  village_id: z.string(),
  period: z.object({ from: z.string(), to: z.string() }),
  kpis: VillageKpisSchema,
  weights: z.record(z.string(), z.number()),
  composite_score: z.number().min(0).max(1),
  cycle_count: z.number().int().min(0),
  computed_at: z.string(),
});
export type VillageScore = z.infer<typeof VillageScoreSchema>;
