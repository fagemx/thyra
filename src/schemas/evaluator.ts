/**
 * Evaluator Rule Schema — 用戶定義的品質標準
 *
 * Judge pipeline 第 4 層。判斷 change 是否「好」（不只是合法）。
 * v1 使用 structured JSON predicates（安全、Zod-validatable）。
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Condition — 結構化條件（D2 決策）
// ---------------------------------------------------------------------------

export const EvaluatorOperatorEnum = z.enum(['lt', 'gt', 'lte', 'gte', 'eq', 'ne']);

export const EvaluatorConditionSchema = z.object({
  /** 要檢查的欄位路徑，如 "change.max_cost_per_action" */
  field: z.string().min(1),
  /** 比較運算子 */
  operator: EvaluatorOperatorEnum,
  /** 字面值比較（與 ref 二擇一） */
  value: z.union([z.number(), z.string(), z.boolean()]).optional(),
  /** 參考欄位路徑，如 "constitution.budget_limits.max_cost_per_action" */
  ref: z.string().optional(),
  /** 對 ref 值乘以此倍數後再比較 */
  multiplier: z.number().optional(),
}).refine(
  (c) => c.value !== undefined || c.ref !== undefined,
  { message: 'Either value or ref must be provided' },
);

// ---------------------------------------------------------------------------
// On-fail action — warn / require_human_approval / reject
// ---------------------------------------------------------------------------

export const EvaluatorOnFailSchema = z.object({
  risk: z.enum(['low', 'medium', 'high']),
  action: z.enum(['warn', 'require_human_approval', 'reject']),
});

// ---------------------------------------------------------------------------
// EvaluatorRule — 單條品質規則
// ---------------------------------------------------------------------------

export const EvaluatorRuleSchema = z.object({
  /** 規則名稱（唯一識別） */
  name: z.string().min(1),
  /** 觸發此 rule 的 change types（exact、array、或 "*" 匹配全部） */
  trigger: z.union([z.string(), z.array(z.string())]),
  /** 結構化條件 */
  condition: EvaluatorConditionSchema,
  /** 條件不滿足時的動作 */
  on_fail: EvaluatorOnFailSchema,
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EvaluatorOperator = z.infer<typeof EvaluatorOperatorEnum>;
export type EvaluatorCondition = z.infer<typeof EvaluatorConditionSchema>;
export type EvaluatorOnFail = z.infer<typeof EvaluatorOnFailSchema>;
export type EvaluatorRule = z.infer<typeof EvaluatorRuleSchema>;
