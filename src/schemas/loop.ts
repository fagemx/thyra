import { z } from 'zod';

// ---------------------------------------------------------------------------
// PlanState v1 — 多步計畫型別
// ---------------------------------------------------------------------------

/** 計畫步驟狀態 */
export const PlannedStepStatusSchema = z.enum([
  'pending',      // 尚未執行
  'in_progress',  // 正在執行
  'blocked',      // 被阻擋（需要 repair）
  'skipped',      // 被 repair 跳過
]);

/** 計畫中的單一步驟 */
export const PlannedStepSchema = z.object({
  task_key: z.string().min(1),
  estimated_cost: z.number().min(0),
  reason: z.string().min(1),
  depends_on: z.array(z.string()).optional(),
  status: PlannedStepStatusSchema.default('pending'),
});
export type PlannedStep = z.infer<typeof PlannedStepSchema>;

/** 已完成的步驟（擴展 PlannedStep） */
export const CompletedStepSchema = PlannedStepSchema.extend({
  actual_cost: z.number().min(0),
  result: z.string(),
  completed_at: z.string(),
});
export type CompletedStep = z.infer<typeof CompletedStepSchema>;

/** Fallback 策略 */
export const FallbackStrategySchema = z.enum([
  'retry',         // 重試相同步驟
  'skip',          // 跳過並繼續
  'replan',        // 觸發 LLM 重新規劃
  'abort',         // 中止整個計畫
]);

/** PlanState v1 — 完整的多步計畫狀態 */
export const PlanStateSchema = z.object({
  version: z.literal('v1').default('v1'),
  objective: z.string().min(1),
  planned_steps: z.array(PlannedStepSchema).min(1),
  completed_steps: z.array(CompletedStepSchema).default([]),
  fallback: FallbackStrategySchema.default('replan'),
  success_criteria: z.string().min(1),
  stop_criteria: z.string().min(1),
});
export type PlanState = z.infer<typeof PlanStateSchema>;

// ---------------------------------------------------------------------------
// CycleIntent — 向後相容（支援 legacy + plan-based）
// ---------------------------------------------------------------------------

export const CycleIntentSchema = z.object({
  goal_kind: z.string(),
  stage_hint: z.string(),
  origin_reason: z.string(),
  last_decision_summary: z.string(),
  // PlanState v1 可選欄位 — 有 plan 時為 plan-based flow
  plan: PlanStateSchema.optional(),
});

export type CycleIntent = z.infer<typeof CycleIntentSchema>;

export const StartCycleInput = z.object({
  chief_id: z.string().min(1),
  trigger: z.enum(['scheduled', 'event', 'manual']).default('manual'),
  timeout_ms: z.number().int().min(1000).max(600_000).default(300_000), // 5 min default (THY-08)
  max_iterations: z.number().int().min(1).max(100).default(10),
  intent: CycleIntentSchema.nullable().optional(),
});

export const StopCycleInput = z.object({
  reason: z.string().optional().default('Human stop'),
});

export type StartCycleInputRaw = z.input<typeof StartCycleInput>;
export type StartCycleInput = z.infer<typeof StartCycleInput>;
export type StopCycleInput = z.infer<typeof StopCycleInput>;

export const LoopActionStatus = z.enum(['executed', 'pending_approval', 'blocked']);

export interface LoopAction {
  type: string;
  description: string;
  estimated_cost: number;
  risk_level: 'low' | 'medium' | 'high';
  status: z.infer<typeof LoopActionStatus>;
  reason: string;
  result?: unknown;
  blocked_reasons?: string[];
}

export interface LoopCycle {
  id: string;
  village_id: string;
  chief_id: string;
  trigger: 'scheduled' | 'event' | 'manual';
  status: 'running' | 'completed' | 'timeout' | 'aborted';
  version: number;
  budget_remaining: number;
  cost_incurred: number;
  iterations: number;
  max_iterations: number;
  timeout_ms: number;
  actions: LoopAction[];
  laws_proposed: string[];
  laws_enacted: string[];
  abort_reason: string | null;
  intent: CycleIntent | null;
  created_at: string;
  updated_at: string;
}
