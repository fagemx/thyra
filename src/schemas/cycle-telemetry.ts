/**
 * cycle-telemetry.ts — Governance cycle 的 per-operation telemetry schemas
 *
 * 記錄每輪 chief cycle 各步驟的耗時、狀態、成本。
 * Phase 1: 記到 DB + 簡單 API。Phase 2: OpenTelemetry export。
 *
 * 參考 vm0/e7h4n: per-operation timing, Axiom export。
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// 列舉
// ---------------------------------------------------------------------------

/** 操作名稱 — 涵蓋三條執行路徑 */
export const OperationNameEnum = z.enum([
  // Legacy rule-based path
  'get_state',
  'decide',
  'judge',
  'apply',
  // Heartbeat protocol path
  'build_context',
  'invoke_adapter',
  'process_result',
  // Pipeline dispatch path
  'dispatch_pipeline',
]);
export type OperationName = z.infer<typeof OperationNameEnum>;

/** 操作狀態 */
export const OperationStatusEnum = z.enum([
  'ok',
  'error',
  'skipped',
]);
export type OperationStatus = z.infer<typeof OperationStatusEnum>;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/** 可選的操作 metadata（LLM 成本、錯誤等） */
export const OperationMetadataSchema = z.object({
  tokens_used: z.number().optional(),
  cost_cents: z.number().optional(),
  model: z.string().optional(),
  error: z.string().optional(),
  detail: z.string().optional(),
}).strict();
export type OperationMetadata = z.infer<typeof OperationMetadataSchema>;

/** 單一操作的計時記錄 */
export const OperationTimingSchema = z.object({
  name: OperationNameEnum,
  duration_ms: z.number().min(0),
  status: OperationStatusEnum,
  metadata: OperationMetadataSchema.optional(),
});
export type OperationTiming = z.infer<typeof OperationTimingSchema>;

/** 一輪 chief cycle 的完整 telemetry */
export const CycleTelemetrySchema = z.object({
  id: z.string(),
  cycle_id: z.string(),
  chief_id: z.string(),
  village_id: z.string(),
  total_duration_ms: z.number().min(0),
  operations: z.array(OperationTimingSchema),
  created_at: z.string(),
});
export type CycleTelemetry = z.infer<typeof CycleTelemetrySchema>;

/** Telemetry 彙總結果 */
export const TelemetrySummarySchema = z.object({
  cycle_count: z.number(),
  avg_duration_ms: z.number(),
  max_duration_ms: z.number(),
  total_cost_cents: z.number(),
  slowest_operation: z.object({
    name: z.string(),
    avg_ms: z.number(),
  }).nullable(),
  operation_breakdown: z.array(z.object({
    name: z.string(),
    avg_ms: z.number(),
    error_rate: z.number(),
  })),
});
export type TelemetrySummary = z.infer<typeof TelemetrySummarySchema>;
