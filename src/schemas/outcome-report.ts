/**
 * schemas/outcome-report.ts — OutcomeReport Zod schemas
 *
 * 定義 outcome evaluation 結果的型別：
 * - ExpectedEffectResult: 預期效果的 baseline vs observed 比較
 * - SideEffectResult: 非預期變動的偵測與嚴重度分類
 * - OutcomeVerdict / OutcomeRecommendation: 評估結論與建議
 * - OutcomeReport: 完整的 outcome 評估報告
 *
 * @see docs/plan/world-cycle/TRACK_E_OUTCOME_COLLECTOR.md Step 2-3
 * @see docs/world-design-v0/shared-types.md §6.9
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// ExpectedEffectResult — 預期效果比較結果
// ---------------------------------------------------------------------------

export const ExpectedEffectResultSchema = z.object({
  metric: z.string(),
  expectedDirection: z.enum(['up', 'down', 'stable']),
  baseline: z.number(),
  observed: z.number(),
  delta: z.number(),
  matched: z.boolean(),
});
export type ExpectedEffectResult = z.infer<typeof ExpectedEffectResultSchema>;

// ---------------------------------------------------------------------------
// SideEffectResult — 副作用偵測結果
// ---------------------------------------------------------------------------

export const SideEffectResultSchema = z.object({
  metric: z.string(),
  baseline: z.number(),
  observed: z.number(),
  delta: z.number(),
  severity: z.enum(['negligible', 'minor', 'significant']),
  acceptable: z.boolean(),
});
export type SideEffectResult = z.infer<typeof SideEffectResultSchema>;

// ---------------------------------------------------------------------------
// OutcomeVerdict — 評估結論
// ---------------------------------------------------------------------------

export const OutcomeVerdictSchema = z.enum(['beneficial', 'neutral', 'harmful', 'inconclusive']);
export type OutcomeVerdict = z.infer<typeof OutcomeVerdictSchema>;

// ---------------------------------------------------------------------------
// OutcomeRecommendation — 建議動作
// ---------------------------------------------------------------------------

export const OutcomeRecommendationSchema = z.enum(['reinforce', 'retune', 'watch', 'rollback', 'do_not_repeat']);
export type OutcomeRecommendation = z.infer<typeof OutcomeRecommendationSchema>;

// ---------------------------------------------------------------------------
// OutcomeReport — 完整評估報告
// ---------------------------------------------------------------------------

export const OutcomeReportSchema = z.object({
  id: z.string(),
  appliedChangeId: z.string(),
  outcomeWindowId: z.string(),
  primaryObjectiveMet: z.boolean(),
  expectedEffects: z.array(ExpectedEffectResultSchema),
  sideEffects: z.array(SideEffectResultSchema),
  verdict: OutcomeVerdictSchema,
  recommendation: OutcomeRecommendationSchema,
  notes: z.array(z.string()),
  createdAt: z.string(),
  version: z.number().int().default(1),
});
export type OutcomeReport = z.infer<typeof OutcomeReportSchema>;
