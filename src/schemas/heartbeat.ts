/**
 * heartbeat.ts — Heartbeat Protocol 的 Zod schemas
 *
 * 定義 Thyra 與 agent 之間的心跳協定：
 *   - HeartbeatContext: Thyra 發出的心跳（包含狀態、任務、約束）
 *   - HeartbeatResult: Agent 回報的結果（包含提案、使用量）
 *
 * Context mode:
 *   - fat: Thyra 把 world state 等全部塞進 payload（適合簡單 agent）
 *   - thin: Thyra 只發 ping，agent 自己呼叫 API 取 context（適合複雜 agent）
 *
 * 參考 Paperclip: heartbeat = universal agent invocation mechanism。
 */

import { z } from 'zod';
import { WorldChangeSchema } from './world-change';

// ---------------------------------------------------------------------------
// 列舉
// ---------------------------------------------------------------------------

/** 心跳觸發方式 */
export const HeartbeatTriggerEnum = z.enum([
  'scheduled',   // 定時排程
  'assignment',  // 任務分配
  'on_demand',   // 手動觸發
  'event',       // 事件驅動
]);
export type HeartbeatTrigger = z.infer<typeof HeartbeatTriggerEnum>;

/** Context 傳遞模式 */
export const ContextModeEnum = z.enum([
  'fat',   // 完整 context 塞進 payload
  'thin',  // 只發 ping，agent 自己取 context
]);
export type ContextMode = z.infer<typeof ContextModeEnum>;

/** Adapter 類型 — 決定由哪種 adapter 處理 chief 的心跳 */
export const AdapterTypeEnum = z.enum([
  'local',   // 本地 rule-based（預設）
  'http',    // HTTP endpoint
  'karvi',   // Karvi pipeline
  'custom',  // 自訂
]);
export type AdapterType = z.infer<typeof AdapterTypeEnum>;

/** 心跳結果狀態 */
export const HeartbeatStatusEnum = z.enum([
  'completed',    // 正常完成
  'failed',       // 執行失敗
  'needs_input',  // 需要人類介入
  'in_progress',  // 非同步執行中
]);
export type HeartbeatStatus = z.infer<typeof HeartbeatStatusEnum>;

// ---------------------------------------------------------------------------
// HeartbeatContext — Thyra 發給 agent 的心跳 payload
// ---------------------------------------------------------------------------

export const HeartbeatContextSchema = z.object({
  /** 唯一心跳 ID（用於關聯 result） */
  heartbeat_id: z.string().min(1),

  /** Village ID */
  village_id: z.string().min(1),

  /** Chief ID */
  chief_id: z.string().min(1),

  /** 觸發方式 */
  trigger: HeartbeatTriggerEnum,

  /** Context 傳遞模式 */
  context_mode: ContextModeEnum,

  // --- 狀態摘要（fat mode 填入，thin mode 省略）---

  /** 世界狀態摘要 */
  world_state_summary: z.record(z.unknown()).optional(),

  /** 市場狀態摘要 */
  market_state_summary: z.record(z.unknown()).optional(),

  /** 目標鏈（#225） */
  goals: z.array(z.record(z.unknown())).optional(),

  /** 先例（#222，if use_precedents） */
  precedents: z.array(z.record(z.unknown())).optional(),

  // --- 約束（始終存在）---

  /** 剩餘預算 */
  budget_remaining: z.number(),

  /** Chief 持有的權限 */
  permissions: z.array(z.string()),

  /** Constitution 規則描述 */
  constitution_rules: z.array(z.string()),

  // --- 任務 ---

  /** 分配的任務（若有） */
  assigned_tasks: z.array(z.record(z.unknown())).default([]),
});

export type HeartbeatContext = z.infer<typeof HeartbeatContextSchema>;

// ---------------------------------------------------------------------------
// HeartbeatUsage — 資源消耗記錄
// ---------------------------------------------------------------------------

export const HeartbeatUsageSchema = z.object({
  /** 輸入 token 數 */
  input_tokens: z.number().int().min(0).optional(),

  /** 輸出 token 數 */
  output_tokens: z.number().int().min(0).optional(),

  /** 成本（美分） */
  cost_cents: z.number().min(0).optional(),

  /** 執行時間（ms） */
  duration_ms: z.number().min(0),
});

export type HeartbeatUsage = z.infer<typeof HeartbeatUsageSchema>;

// ---------------------------------------------------------------------------
// HeartbeatResult — Agent 回報的心跳結果
// ---------------------------------------------------------------------------

export const HeartbeatResultSchema = z.object({
  /** 對應的心跳 ID */
  heartbeat_id: z.string().min(1),

  /** 執行狀態 */
  status: HeartbeatStatusEnum,

  /** 提案（送 judge pipeline） */
  proposals: z.array(WorldChangeSchema).optional(),

  /** 任務狀態更新 */
  task_updates: z.array(z.record(z.unknown())).optional(),

  /** 分析報告（不是 WorldChange，只是資訊） */
  reports: z.array(z.record(z.unknown())).optional(),

  /** 資源消耗 */
  usage: HeartbeatUsageSchema.optional(),
});

export type HeartbeatResult = z.infer<typeof HeartbeatResultSchema>;
