/**
 * world/evaluator.ts — 品質評估層（Judge pipeline Layer 4）
 *
 * Pure function，無 DB 依賴。接收 WorldState + WorldChange + EvaluatorRule[]，
 * 回傳 EvaluatorCheckResult。
 *
 * 與 Risk Assessor (T5) 互補：
 * - RiskAssessor: action-level (THY-03), pre-execution, uses DB
 * - Evaluator: change-level, inside judge pipeline, pure function
 */

import type { WorldState } from './state';
import type { WorldChange } from '../schemas/world-change';
import type { EvaluatorRule, EvaluatorCondition, EvaluatorOperator } from '../schemas/evaluator';

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface EvaluatorCheckResult {
  /** 所有 evaluator rules 都通過 */
  passed: boolean;
  /** warn 等級的訊息 */
  warnings: string[];
  /** 是否需要人類批准 */
  requires_approval: boolean;
  /** 詳細 rule 結果 */
  rule_results: Array<{
    rule_name: string;
    triggered: boolean;
    condition_met: boolean;
    action_taken: 'pass' | 'warn' | 'require_human_approval' | 'reject';
  }>;
}

// ---------------------------------------------------------------------------
// Trigger matching（D3 決策）
// ---------------------------------------------------------------------------

function matchesTrigger(trigger: string | string[], changeType: string): boolean {
  if (typeof trigger === 'string') {
    return trigger === '*' || trigger === changeType;
  }
  return trigger.some((t) => t === '*' || t === changeType);
}

// ---------------------------------------------------------------------------
// Field resolution — 從 state/change 中解析欄位值
// ---------------------------------------------------------------------------

function resolveField(
  path: string,
  state: WorldState,
  change: WorldChange,
): number | string | boolean | undefined {
  const parts = path.split('.');

  // change.* — 從 WorldChange 取值
  if (parts[0] === 'change') {
    return getNestedValue(change as Record<string, unknown>, parts.slice(1));
  }

  // constitution.* — 從 state.constitution 取值
  if (parts[0] === 'constitution' && state.constitution) {
    return getNestedValue(state.constitution as unknown as Record<string, unknown>, parts.slice(1));
  }

  // state.* — 從 state 取值（如 state.chiefs.length）
  if (parts[0] === 'state') {
    return getNestedValue(state as unknown as Record<string, unknown>, parts.slice(1));
  }

  return undefined;
}

function getNestedValue(
  obj: Record<string, unknown>,
  parts: string[],
): number | string | boolean | undefined {
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (part === 'length' && Array.isArray(current)) {
      return current.length;
    }
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  if (typeof current === 'number' || typeof current === 'string' || typeof current === 'boolean') {
    return current;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Condition evaluation
// ---------------------------------------------------------------------------

function compareValues(
  left: number | string | boolean,
  operator: EvaluatorOperator,
  right: number | string | boolean,
): boolean {
  // 數值比較
  if (typeof left === 'number' && typeof right === 'number') {
    switch (operator) {
      case 'lt': return left < right;
      case 'gt': return left > right;
      case 'lte': return left <= right;
      case 'gte': return left >= right;
      case 'eq': return left === right;
      case 'ne': return left !== right;
    }
  }

  // 非數值只支持 eq/ne
  switch (operator) {
    case 'eq': return left === right;
    case 'ne': return left !== right;
    default: return false;
  }
}

function evaluateCondition(
  condition: EvaluatorCondition,
  state: WorldState,
  change: WorldChange,
): boolean {
  const fieldValue = resolveField(condition.field, state, change);
  if (fieldValue === undefined) {
    // 欄位不存在 → 條件視為不滿足（觸發 on_fail）
    return false;
  }

  let compareTarget: number | string | boolean;

  if (condition.ref !== undefined) {
    const refValue = resolveField(condition.ref, state, change);
    if (refValue === undefined) return false;
    if (typeof refValue === 'number' && condition.multiplier !== undefined) {
      compareTarget = refValue * condition.multiplier;
    } else {
      compareTarget = refValue;
    }
  } else if (condition.value !== undefined) {
    compareTarget = condition.value;
  } else {
    // Neither value nor ref — should not happen (Zod refine prevents this)
    return false;
  }

  return compareValues(fieldValue, condition.operator, compareTarget);
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * 評估一組 evaluator rules 是否通過。
 *
 * 對於每個 rule：
 * 1. 檢查 trigger 是否匹配 change.type
 * 2. 若匹配，評估 condition
 * 3. 若 condition 不滿足，按 on_fail.action 處理
 *
 * @returns EvaluatorCheckResult
 */
export function checkEvaluator(
  state: WorldState,
  change: WorldChange,
  rules: EvaluatorRule[],
): EvaluatorCheckResult {
  const warnings: string[] = [];
  let requires_approval = false;
  let passed = true;

  const rule_results: EvaluatorCheckResult['rule_results'] = [];

  for (const rule of rules) {
    const triggered = matchesTrigger(rule.trigger, change.type);

    if (!triggered) {
      rule_results.push({
        rule_name: rule.name,
        triggered: false,
        condition_met: true,
        action_taken: 'pass',
      });
      continue;
    }

    const condition_met = evaluateCondition(rule.condition, state, change);

    if (condition_met) {
      rule_results.push({
        rule_name: rule.name,
        triggered: true,
        condition_met: true,
        action_taken: 'pass',
      });
      continue;
    }

    // Condition not met → apply on_fail action
    switch (rule.on_fail.action) {
      case 'warn':
        warnings.push(`EVALUATOR [${rule.name}]: condition not met (${rule.on_fail.risk} risk)`);
        rule_results.push({
          rule_name: rule.name,
          triggered: true,
          condition_met: false,
          action_taken: 'warn',
        });
        break;

      case 'require_human_approval':
        requires_approval = true;
        passed = false;
        warnings.push(`EVALUATOR [${rule.name}]: requires human approval (${rule.on_fail.risk} risk)`);
        rule_results.push({
          rule_name: rule.name,
          triggered: true,
          condition_met: false,
          action_taken: 'require_human_approval',
        });
        break;

      case 'reject':
        passed = false;
        rule_results.push({
          rule_name: rule.name,
          triggered: true,
          condition_met: false,
          action_taken: 'reject',
        });
        break;
    }
  }

  return { passed, warnings, requires_approval, rule_results };
}
