import { z } from 'zod';

// governance.metric.v1 — Karvi 回報效能指標給 Thyra
export const MetricTypeEnum = z.enum([
  'task_completed',
  'task_failed',
  'budget_consumed',
  'loop_duration',
  'review_score',
]);

export const GovernanceMetricSchema = z.object({
  version: z.literal('governance.metric.v1'),
  event_id: z.string().startsWith('evt_'),
  occurred_at: z.string(),
  source: z.literal('karvi'),
  village_id: z.string().min(1),
  metric_type: MetricTypeEnum,
  value: z.number(),
  metadata: z.record(z.unknown()).optional(),
});

export type GovernanceMetric = z.infer<typeof GovernanceMetricSchema>;
export type MetricType = z.infer<typeof MetricTypeEnum>;

/**
 * 驗證並解析來自 Karvi 的 metric event。
 * 回傳 { ok, data?, error? } 格式。
 */
export function parseGovernanceMetric(input: unknown): {
  ok: true;
  data: GovernanceMetric;
} | {
  ok: false;
  error: { code: string; message: string };
} {
  const result = GovernanceMetricSchema.safeParse(input);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  return {
    ok: false,
    error: {
      code: 'INVALID_METRIC',
      message: result.error.issues.map((i) => i.message).join('; '),
    },
  };
}
