import { z } from 'zod';

/**
 * CycleMetrics — 單一 cycle 的量化指標快照
 * 用於事後分析與趨勢追蹤
 */
export const CycleMetricsSchema = z.object({
  /** 已執行的 action 數量 */
  actions_executed: z.number().int().min(0),
  /** 被阻擋的 action 數量 */
  actions_blocked: z.number().int().min(0),
  /** 等待人類審核的 action 數量 */
  actions_pending: z.number().int().min(0),
  /** 預算使用率 0-1 */
  budget_used_ratio: z.number().min(0).max(1),
  /** 提案的法律數量 */
  laws_proposed: z.number().int().min(0),
  /** 已生效的法律數量 */
  laws_enacted: z.number().int().min(0),
  /** 已回滾的法律數量 */
  laws_rolled_back: z.number().int().min(0),
  /** Edda 查詢次數 */
  edda_queries: z.number().int().min(0),
  /** Edda 命中且實際使用的次數 */
  edda_hits_used: z.number().int().min(0),
  /** 推理完整度 0-1（基於 reasoning.confidence） */
  reasoning_completeness: z.number().min(0).max(1),
});
export type CycleMetrics = z.infer<typeof CycleMetricsSchema>;

/**
 * DecideSnapshot — 決策引擎的可重播快照
 * 記錄 context + result，可用於回歸測試與決定性驗證
 */
export const DecideSnapshotSchema = z.object({
  /** 決策上下文（DecideContext 的完整快照） */
  context: z.record(z.unknown()),
  /** 決策結果（DecideResult 的完整快照） */
  result: z.record(z.unknown()),
  /** 決策引擎版本 */
  engine_version: z.string(),
  /** Schema 版本標記 */
  schema_version: z.literal('snapshot.v1'),
  /** context 的 SHA-256 hash（用於快速比對） */
  context_hash: z.string(),
});
export type DecideSnapshot = z.infer<typeof DecideSnapshotSchema>;
