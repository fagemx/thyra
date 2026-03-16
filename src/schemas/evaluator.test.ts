import { describe, it, expect } from 'vitest';
import { EvaluatorRuleSchema, EvaluatorConditionSchema } from './evaluator';

describe('EvaluatorConditionSchema', () => {
  it('accepts condition with value', () => {
    const result = EvaluatorConditionSchema.safeParse({
      field: 'change.max_cost_per_action',
      operator: 'lt',
      value: 100,
    });
    expect(result.success).toBe(true);
  });

  it('accepts condition with ref and multiplier', () => {
    const result = EvaluatorConditionSchema.safeParse({
      field: 'change.max_cost_per_action',
      operator: 'lt',
      ref: 'constitution.budget_limits.max_cost_per_action',
      multiplier: 2,
    });
    expect(result.success).toBe(true);
  });

  it('rejects condition with neither value nor ref', () => {
    const result = EvaluatorConditionSchema.safeParse({
      field: 'change.max_cost_per_action',
      operator: 'lt',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid operator', () => {
    const result = EvaluatorConditionSchema.safeParse({
      field: 'change.x',
      operator: 'invalid',
      value: 10,
    });
    expect(result.success).toBe(false);
  });
});

describe('EvaluatorRuleSchema', () => {
  it('accepts valid rule with string trigger', () => {
    const result = EvaluatorRuleSchema.safeParse({
      name: 'budget-guard',
      trigger: 'budget.adjust',
      condition: { field: 'change.max_cost_per_action', operator: 'lt', value: 100 },
      on_fail: { risk: 'medium', action: 'reject' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid rule with array trigger', () => {
    const result = EvaluatorRuleSchema.safeParse({
      name: 'multi-trigger',
      trigger: ['budget.adjust', 'law.propose'],
      condition: { field: 'change.max_cost_per_action', operator: 'lte', value: 50 },
      on_fail: { risk: 'low', action: 'warn' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects rule with empty name', () => {
    const result = EvaluatorRuleSchema.safeParse({
      name: '',
      trigger: '*',
      condition: { field: 'change.x', operator: 'eq', value: 1 },
      on_fail: { risk: 'low', action: 'warn' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects rule with invalid on_fail action', () => {
    const result = EvaluatorRuleSchema.safeParse({
      name: 'test',
      trigger: '*',
      condition: { field: 'change.x', operator: 'eq', value: 1 },
      on_fail: { risk: 'low', action: 'explode' },
    });
    expect(result.success).toBe(false);
  });
});
