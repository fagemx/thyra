/**
 * adapter.ts — Adapter action Zod schemas。
 *
 * 定義平台 adapter 的 action 類型和執行報告。
 * ADAPTER-02: adapter 只讀，不寫 world state。
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// AdapterAction — 平台動作定義
// ---------------------------------------------------------------------------

export const AdapterActionTypeSchema = z.enum(['post', 'notify', 'update', 'alert']);

export const AdapterActionSchema = z.object({
  type: AdapterActionTypeSchema,
  platform: z.string().min(1),
  content: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
});

export type AdapterAction = z.infer<typeof AdapterActionSchema>;
export type AdapterActionType = z.infer<typeof AdapterActionTypeSchema>;

// ---------------------------------------------------------------------------
// AdapterExecutionReport — executeAll 回傳報告
// ---------------------------------------------------------------------------

export const AdapterExecutionReportSchema = z.object({
  total: z.number().int().min(0),
  dispatched: z.number().int().min(0),
  skipped: z.number().int().min(0),
  failed: z.array(z.string()),
});

export type AdapterExecutionReport = z.infer<typeof AdapterExecutionReportSchema>;
