import { describe, it, expect } from 'vitest';
import { checkEvaluator } from './evaluator';
import type { WorldState } from './state';
import type { WorldChange } from '../schemas/world-change';
import type { EvaluatorRule } from '../schemas/evaluator';
import type { Village } from '../village-manager';
import type { Constitution } from '../constitution-store';
import type { Chief } from '../chief-engine';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeVillage(overrides: Partial<Village> = {}): Village {
  return {
    id: 'village-1',
    name: 'Test Village',
    description: 'A test village',
    target_repo: 'org/repo',
    status: 'active',
    metadata: {},
    version: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeConstitution(overrides: Partial<Constitution> = {}): Constitution {
  return {
    id: 'const-1',
    village_id: 'village-1',
    version: 1,
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    created_by: 'human',
    rules: [{ id: 'rule-1', description: 'Must write tests', enforcement: 'hard', scope: ['*'] }],
    allowed_permissions: ['dispatch_task', 'propose_law', 'enact_law_low'],
    budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50, max_cost_per_month: 0 },
    superseded_by: null,
    ...overrides,
  };
}

function makeChief(overrides: Partial<Chief> = {}): Chief {
  return {
    id: 'chief-1',
    village_id: 'village-1',
    name: 'Alpha',
    role: 'developer',
    version: 1,
    status: 'active',
    skills: [],
    pipelines: [],
    permissions: ['dispatch_task'],
    personality: { risk_tolerance: 'moderate', communication_style: 'concise', decision_speed: 'deliberate' },
    constraints: [],
    profile: null,
    adapter_type: 'local' as const,
    context_mode: 'fat' as const,
    adapter_config: {},
    budget_config: null,
    pause_reason: null,
    paused_at: null,
    last_heartbeat_at: null,
    current_run_id: null,
    current_run_status: 'idle' as const,
    timeout_count: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeState(overrides: Partial<WorldState> = {}): WorldState {
  return {
    village: makeVillage(),
    constitution: makeConstitution(),
    chiefs: [makeChief()],
    active_laws: [],
    skills: [],
    running_cycles: [],
    goals: [],
    assembled_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('checkEvaluator', () => {
  // --- 1. No rules → all pass ---
  it('passes when no rules are provided', () => {
    const state = makeState();
    const change: WorldChange = { type: 'village.update', name: 'New Name' };
    const result = checkEvaluator(state, change, []);

    expect(result.passed).toBe(true);
    expect(result.warnings).toHaveLength(0);
    expect(result.requires_approval).toBe(false);
    expect(result.rule_results).toHaveLength(0);
  });

  // --- 2. Rule not triggered (trigger doesn't match) ---
  it('skips rule when trigger does not match change type', () => {
    const rule: EvaluatorRule = {
      name: 'budget-guard',
      trigger: 'budget.adjust',
      condition: { field: 'change.max_cost_per_action', operator: 'lt', value: 100 },
      on_fail: { risk: 'medium', action: 'reject' },
    };
    const state = makeState();
    const change: WorldChange = { type: 'village.update', name: 'New' };
    const result = checkEvaluator(state, change, [rule]);

    expect(result.passed).toBe(true);
    expect(result.rule_results).toHaveLength(1);
    expect(result.rule_results[0].triggered).toBe(false);
    expect(result.rule_results[0].action_taken).toBe('pass');
  });

  // --- 3. Wildcard trigger matches all ---
  it('triggers rule with wildcard "*" trigger', () => {
    const rule: EvaluatorRule = {
      name: 'all-changes-warn',
      trigger: '*',
      condition: { field: 'state.chiefs.length', operator: 'gt', value: 10 },
      on_fail: { risk: 'low', action: 'warn' },
    };
    const state = makeState();
    const change: WorldChange = { type: 'village.update', name: 'New' };
    const result = checkEvaluator(state, change, [rule]);

    // chiefs.length = 1, not > 10, so condition fails → warn
    expect(result.passed).toBe(true); // warn doesn't block
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('all-changes-warn');
  });

  // --- 4. Array trigger ---
  it('triggers rule with array trigger matching change type', () => {
    const rule: EvaluatorRule = {
      name: 'multi-trigger',
      trigger: ['budget.adjust', 'law.propose'],
      condition: { field: 'change.max_cost_per_action', operator: 'lte', value: 50 },
      on_fail: { risk: 'high', action: 'reject' },
    };
    const state = makeState();
    const change: WorldChange = { type: 'budget.adjust', max_cost_per_action: 60 };
    const result = checkEvaluator(state, change, [rule]);

    expect(result.passed).toBe(false);
    expect(result.rule_results[0].triggered).toBe(true);
    expect(result.rule_results[0].condition_met).toBe(false);
    expect(result.rule_results[0].action_taken).toBe('reject');
  });

  // --- 5. Condition met → pass ---
  it('passes when condition is satisfied', () => {
    const rule: EvaluatorRule = {
      name: 'budget-check',
      trigger: 'budget.adjust',
      condition: { field: 'change.max_cost_per_action', operator: 'lt', value: 100 },
      on_fail: { risk: 'medium', action: 'reject' },
    };
    const state = makeState();
    const change: WorldChange = { type: 'budget.adjust', max_cost_per_action: 50 };
    const result = checkEvaluator(state, change, [rule]);

    expect(result.passed).toBe(true);
    expect(result.rule_results[0].condition_met).toBe(true);
    expect(result.rule_results[0].action_taken).toBe('pass');
  });

  // --- 6. on_fail: warn → passed stays true, warnings populated ---
  it('warns but allows when on_fail action is warn', () => {
    const rule: EvaluatorRule = {
      name: 'soft-limit',
      trigger: 'budget.adjust',
      condition: { field: 'change.max_cost_per_action', operator: 'lte', value: 20 },
      on_fail: { risk: 'low', action: 'warn' },
    };
    const state = makeState();
    const change: WorldChange = { type: 'budget.adjust', max_cost_per_action: 30 };
    const result = checkEvaluator(state, change, [rule]);

    expect(result.passed).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('soft-limit');
    expect(result.warnings[0]).toContain('low risk');
    expect(result.requires_approval).toBe(false);
  });

  // --- 7. on_fail: require_human_approval ---
  it('blocks and sets requires_approval when on_fail is require_human_approval', () => {
    const rule: EvaluatorRule = {
      name: 'price-stability',
      trigger: 'budget.adjust',
      condition: { field: 'change.max_cost_per_action', operator: 'lt', value: 50 },
      on_fail: { risk: 'medium', action: 'require_human_approval' },
    };
    const state = makeState();
    const change: WorldChange = { type: 'budget.adjust', max_cost_per_action: 80 };
    const result = checkEvaluator(state, change, [rule]);

    expect(result.passed).toBe(false);
    expect(result.requires_approval).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('requires human approval');
  });

  // --- 8. on_fail: reject ---
  it('rejects when on_fail action is reject', () => {
    const rule: EvaluatorRule = {
      name: 'hard-limit',
      trigger: 'budget.adjust',
      condition: { field: 'change.max_cost_per_action', operator: 'lt', value: 100 },
      on_fail: { risk: 'high', action: 'reject' },
    };
    const state = makeState();
    const change: WorldChange = { type: 'budget.adjust', max_cost_per_action: 150 };
    const result = checkEvaluator(state, change, [rule]);

    expect(result.passed).toBe(false);
    expect(result.requires_approval).toBe(false);
    expect(result.rule_results[0].action_taken).toBe('reject');
  });

  // --- 9. Ref-based comparison with multiplier ---
  it('compares field against ref value with multiplier', () => {
    const rule: EvaluatorRule = {
      name: 'budget-2x-guard',
      trigger: 'budget.adjust',
      condition: {
        field: 'change.max_cost_per_action',
        operator: 'lt',
        ref: 'constitution.budget_limits.max_cost_per_action',
        multiplier: 2,
      },
      on_fail: { risk: 'medium', action: 'reject' },
    };
    const state = makeState(); // budget_limits.max_cost_per_action = 10
    // 10 * 2 = 20, change is 25, not < 20 → condition fails → reject
    const change: WorldChange = { type: 'budget.adjust', max_cost_per_action: 25 };
    const result = checkEvaluator(state, change, [rule]);

    expect(result.passed).toBe(false);
  });

  it('passes when field is under ref * multiplier', () => {
    const rule: EvaluatorRule = {
      name: 'budget-2x-guard',
      trigger: 'budget.adjust',
      condition: {
        field: 'change.max_cost_per_action',
        operator: 'lt',
        ref: 'constitution.budget_limits.max_cost_per_action',
        multiplier: 2,
      },
      on_fail: { risk: 'medium', action: 'reject' },
    };
    const state = makeState(); // max_cost_per_action = 10, * 2 = 20
    const change: WorldChange = { type: 'budget.adjust', max_cost_per_action: 15 };
    const result = checkEvaluator(state, change, [rule]);

    expect(result.passed).toBe(true);
  });

  // --- 10. Multiple rules — mixed results ---
  it('handles multiple rules with mixed outcomes', () => {
    const rules: EvaluatorRule[] = [
      {
        name: 'warn-rule',
        trigger: 'budget.adjust',
        condition: { field: 'change.max_cost_per_action', operator: 'lt', value: 5 },
        on_fail: { risk: 'low', action: 'warn' },
      },
      {
        name: 'pass-rule',
        trigger: 'budget.adjust',
        condition: { field: 'change.max_cost_per_action', operator: 'lt', value: 100 },
        on_fail: { risk: 'high', action: 'reject' },
      },
      {
        name: 'non-trigger',
        trigger: 'law.propose',
        condition: { field: 'change.category', operator: 'ne', value: 'event' },
        on_fail: { risk: 'low', action: 'warn' },
      },
    ];
    const state = makeState();
    const change: WorldChange = { type: 'budget.adjust', max_cost_per_action: 30 };
    const result = checkEvaluator(state, change, rules);

    // warn-rule: triggered, condition fails (30 not < 5) → warn (passed stays true)
    // pass-rule: triggered, condition passes (30 < 100) → pass
    // non-trigger: not triggered → pass
    expect(result.passed).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.rule_results).toHaveLength(3);
    expect(result.rule_results[0].action_taken).toBe('warn');
    expect(result.rule_results[1].action_taken).toBe('pass');
    expect(result.rule_results[2].action_taken).toBe('pass');
  });

  // --- 11. Undefined field → condition not met ---
  it('treats undefined field as condition not met', () => {
    const rule: EvaluatorRule = {
      name: 'missing-field',
      trigger: '*',
      condition: { field: 'change.nonexistent_field', operator: 'eq', value: 'x' },
      on_fail: { risk: 'low', action: 'warn' },
    };
    const state = makeState();
    const change: WorldChange = { type: 'village.update', name: 'New' };
    const result = checkEvaluator(state, change, [rule]);

    expect(result.passed).toBe(true);
    expect(result.warnings).toHaveLength(1);
  });

  // --- 12. state.chiefs.length field resolution ---
  it('resolves state.chiefs.length for condition', () => {
    const rule: EvaluatorRule = {
      name: 'min-chiefs',
      trigger: 'chief.dismiss',
      condition: { field: 'state.chiefs.length', operator: 'gt', value: 1 },
      on_fail: { risk: 'high', action: 'reject' },
    };
    const state = makeState({ chiefs: [makeChief()] }); // 1 chief
    const change: WorldChange = { type: 'chief.dismiss', chief_id: 'chief-1', actor: 'human' };
    const result = checkEvaluator(state, change, [rule]);

    // 1 not > 1 → condition fails → reject
    expect(result.passed).toBe(false);
  });
});
