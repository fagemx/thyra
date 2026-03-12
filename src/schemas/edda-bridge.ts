import { z } from 'zod';

/** Edda query endpoint 的輸入驗證 */
export const EddaQueryInput = z.object({
  q: z.string().optional(),
  domain: z.string().optional(),
  keyword: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  include_superseded: z.boolean().optional(),
  branch: z.string().optional(),
});

export type EddaQueryInput = z.infer<typeof EddaQueryInput>;

/** Edda decide endpoint 的輸入驗證 */
export const EddaDecideInput = z.object({
  domain: z.string().min(1),
  aspect: z.string().min(1),
  value: z.string().min(1),
  reason: z.string().optional(),
});

export type EddaDecideInput = z.infer<typeof EddaDecideInput>;

/** Edda /api/log 回應格式 — Edda 真實格式的單一事件 */
const EddaLogEventRaw = z.object({
  event_id: z.string(),
  event_type: z.string(),
  detail: z.string(),
  ts: z.string(),
  branch: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

/** Edda /api/log 回應格式 — 向後相容陣列格式的單一事件 */
const EddaLogEntryRaw = z.object({
  event_id: z.string(),
  type: z.string(),
  summary: z.string(),
  ts: z.string(),
  branch: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

/** Edda /api/log 回應：{ events: [...] } 或直接陣列 */
export const EddaLogResponseSchema = z.union([
  z.object({ events: z.array(EddaLogEventRaw) }),
  z.array(EddaLogEntryRaw),
]);

export type EddaLogResponse = z.infer<typeof EddaLogResponseSchema>;
