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

/** Edda /api/drafts 回應格式 — 單一 draft proposal */
export const EddaDraftSchema = z.object({
  event_id: z.string(),
  key: z.string(),
  value: z.string(),
  reason: z.string().optional(),
  status: z.string(),
  ts: z.string(),
  branch: z.string().optional(),
});

export type EddaDraftRaw = z.infer<typeof EddaDraftSchema>;

/** Edda /api/drafts 回應：陣列格式 */
export const EddaDraftsResponseSchema = z.array(EddaDraftSchema);

/** Edda DecisionHit — 匹配 /api/decisions 回應中的決策項目 */
const EddaDecisionHitSchema = z.object({
  event_id: z.string(),
  key: z.string(),
  value: z.string(),
  reason: z.string(),
  domain: z.string(),
  branch: z.string(),
  ts: z.string(),
  is_active: z.boolean(),
});

/** Edda CommitHit */
const EddaCommitHitSchema = z.object({
  event_id: z.string(),
  title: z.string(),
  purpose: z.string(),
  ts: z.string(),
  branch: z.string(),
  match_type: z.string(),
});

/** Edda NoteHit */
const EddaNoteHitSchema = z.object({
  event_id: z.string(),
  text: z.string(),
  ts: z.string(),
  branch: z.string(),
});

/** Edda /api/decisions 回應格式（AskResult） */
export const EddaQueryResultSchema = z.object({
  query: z.string(),
  input_type: z.string(),
  decisions: z.array(EddaDecisionHitSchema),
  timeline: z.array(EddaDecisionHitSchema),
  related_commits: z.array(EddaCommitHitSchema),
  related_notes: z.array(EddaNoteHitSchema),
});

/** Edda POST /api/decide 回應格式 */
export const EddaDecideResultSchema = z.object({
  event_id: z.string(),
  superseded: z.string().optional(),
});

/** Edda GET /api/decisions/{id}/outcomes 回應格式 */
export const EddaDecisionOutcomesSchema = z.record(z.string(), z.unknown());
