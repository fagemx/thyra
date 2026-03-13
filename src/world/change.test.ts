import { describe, it, expect } from 'vitest';
import { applyChange, toGovernancePatch } from './change';
import {
  WorldChangeSchema,
  RollbackPlanSchema,
  createWorldChange,
  type WorldChange,
  type ChangeMetadata,
} from '../schemas/world-change';
import type { WorldState } from './state';
import type { Village } from '../village-manager';
import type { Constitution } from '../constitution-store';
import type { Law } from '../law-engine';
import type { Chief } from '../chief-engine';
import type { Skill } from '../skill-registry';

// --- Test helpers ---

function makeVillage(overrides: Partial<Village> = {}): Village {
  return {
    id: 'v_test',
    name: 'Test Village',
    description: 'A test village',
    target_repo: 'test/repo',
    status: 'active',
    metadata: {},
    version: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeConstitution(overrides: Partial<Constitution> = {}): Constitution {
  return {
    id: 'const_1',
    village_id: 'v_test',
    version: 1,
    status: 'active',
    created_at: '2026-01-01T00:00:00.000Z',
    created_by: 'system',
    rules: [{ id: 'r1', description: 'Be good', enforcement: 'hard', scope: ['*'] }],
    allowed_permissions: ['dispatch_task', 'propose_law'],
    budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
    superseded_by: null,
    ...overrides,
  };
}

function makeLaw(overrides: Partial<Law> = {}): Law {
  return {
    id: 'law_1',
    village_id: 'v_test',
    proposed_by: 'chief_1',
    approved_by: null,
    version: 1,
    status: 'active',
    category: 'testing',
    content: { description: 'Test law', strategy: {} },
    risk_level: 'low',
    evidence: { source: 'test', reasoning: 'testing' },
    effectiveness: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeChief(overrides: Partial<Chief> = {}): Chief {
  return {
    id: 'chief_1',
    village_id: 'v_test',
    name: 'Test Chief',
    role: 'Developer',
    version: 1,
    status: 'active',
    skills: [],
    permissions: ['dispatch_task'],
    personality: { risk_tolerance: 'moderate', communication_style: 'concise', decision_speed: 'deliberate' },
    constraints: [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: 'skill_1',
    name: 'test-skill',
    version: 1,
    status: 'verified',
    village_id: 'v_test',
    definition: {
      description: 'A test skill',
      prompt_template: 'Do something',
      tools_required: [],
      constraints: [],
      examples: [],
    },
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    verified_at: '2026-01-01T00:00:00.000Z',
    verified_by: 'admin',
    ...overrides,
  };
}

function makeWorldState(overrides: Partial<WorldState> = {}): WorldState {
  return {
    village: makeVillage(),
    constitution: null,
    chiefs: [],
    active_laws: [],
    skills: [],
    running_cycles: [],
    assembled_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeMetadata(overrides: Partial<ChangeMetadata> = {}): ChangeMetadata {
  return {
    change_id: 'chg_test-001',
    village_id: 'v_test',
    proposed_by: 'admin',
    proposed_at: '2026-01-02T00:00:00.000Z',
    description: 'Test change',
    estimated_cost: 0,
    rollback_plan: { strategy: 'noop' },
    ...overrides,
  };
}

// ============================================================
// Schema validation tests
// ============================================================

describe('WorldChangeSchema', () => {
  it('accepts a valid constitution.create change', () => {
    const change = {
      ...makeMetadata(),
      change_type: 'constitution.create',
      payload: {
        rules: [{ description: 'Rule 1', enforcement: 'hard' }],
        allowed_permissions: ['dispatch_task'],
      },
    };
    const result = WorldChangeSchema.safeParse(change);
    expect(result.success).toBe(true);
  });

  it('rejects missing required fields', () => {
    const change = {
      change_type: 'constitution.create',
      payload: {
        rules: [{ description: 'Rule 1', enforcement: 'hard' }],
        allowed_permissions: ['dispatch_task'],
      },
    };
    const result = WorldChangeSchema.safeParse(change);
    expect(result.success).toBe(false);
  });

  it('rejects unknown change_type', () => {
    const change = {
      ...makeMetadata(),
      change_type: 'unknown.type',
      payload: {},
    };
    const result = WorldChangeSchema.safeParse(change);
    expect(result.success).toBe(false);
  });

  it('rejects change_id without chg_ prefix', () => {
    const change = {
      ...makeMetadata({ change_id: 'bad_id' }),
      change_type: 'constitution.create',
      payload: {
        rules: [{ description: 'Rule 1', enforcement: 'hard' }],
        allowed_permissions: ['dispatch_task'],
      },
    };
    const result = WorldChangeSchema.safeParse(change);
    expect(result.success).toBe(false);
  });

  it('rejects negative estimated_cost', () => {
    const change = {
      ...makeMetadata({ estimated_cost: -5 }),
      change_type: 'constitution.create',
      payload: {
        rules: [{ description: 'Rule 1', enforcement: 'hard' }],
        allowed_permissions: ['dispatch_task'],
      },
    };
    const result = WorldChangeSchema.safeParse(change);
    expect(result.success).toBe(false);
  });

  it('accepts all RollbackPlan strategies', () => {
    const strategies = [
      { strategy: 'reversible', reverse_change_type: 'constitution.revoke', description: 'undo' },
      { strategy: 'supersede', description: 'replace' },
      { strategy: 'irreversible', reason: 'THY-01' },
      { strategy: 'noop' },
    ];
    for (const plan of strategies) {
      const result = RollbackPlanSchema.safeParse(plan);
      expect(result.success).toBe(true);
    }
  });

  it('validates all 13 change types', () => {
    const changes: Record<string, unknown>[] = [
      {
        ...makeMetadata(), change_type: 'constitution.create',
        payload: { rules: [{ description: 'r', enforcement: 'hard' }], allowed_permissions: ['dispatch_task'] },
      },
      {
        ...makeMetadata(), change_type: 'constitution.supersede',
        payload: { old_id: 'c1', new_input: { rules: [{ description: 'r', enforcement: 'hard' }], allowed_permissions: ['dispatch_task'] } },
      },
      {
        ...makeMetadata(), change_type: 'constitution.revoke',
        payload: { constitution_id: 'c1' },
      },
      {
        ...makeMetadata(), change_type: 'law.propose',
        payload: { chief_id: 'ch1', input: { category: 'test', content: { description: 'x', strategy: {} }, evidence: { source: 's', reasoning: 'r' } } },
      },
      {
        ...makeMetadata(), change_type: 'law.approve',
        payload: { law_id: 'l1' },
      },
      {
        ...makeMetadata(), change_type: 'law.revoke',
        payload: { law_id: 'l1' },
      },
      {
        ...makeMetadata(), change_type: 'law.rollback',
        payload: { law_id: 'l1', reason: 'bad' },
      },
      {
        ...makeMetadata(), change_type: 'chief.create',
        payload: { name: 'Chief', role: 'Dev' },
      },
      {
        ...makeMetadata(), change_type: 'chief.update',
        payload: { chief_id: 'ch1', updates: { name: 'New' } },
      },
      {
        ...makeMetadata(), change_type: 'chief.deactivate',
        payload: { chief_id: 'ch1' },
      },
      {
        ...makeMetadata(), change_type: 'skill.register',
        payload: { name: 'my-skill', definition: { description: 'd', prompt_template: 'p' } },
      },
      {
        ...makeMetadata(), change_type: 'skill.verify',
        payload: { skill_id: 's1' },
      },
      {
        ...makeMetadata(), change_type: 'skill.deprecate',
        payload: { skill_id: 's1' },
      },
    ];

    for (const change of changes) {
      const result = WorldChangeSchema.safeParse(change);
      expect(result.success, `Failed for ${change.change_type as string}: ${JSON.stringify(result)}`).toBe(true);
    }
  });
});

describe('createWorldChange', () => {
  it('auto-generates change_id and proposed_at', () => {
    const change = createWorldChange({
      village_id: 'v_test',
      proposed_by: 'admin',
      description: 'Test',
      estimated_cost: 0,
      rollback_plan: { strategy: 'noop' },
      change_type: 'constitution.revoke' as const,
      payload: { constitution_id: 'c1' },
    });

    expect(change.change_id).toMatch(/^chg_/);
    expect(change.proposed_at).toBeTruthy();
    expect(change.change_type).toBe('constitution.revoke');
  });

  it('preserves explicitly provided change_id', () => {
    const change = createWorldChange({
      change_id: 'chg_explicit',
      village_id: 'v_test',
      proposed_by: 'admin',
      proposed_at: '2026-06-01T00:00:00.000Z',
      description: 'Test',
      estimated_cost: 0,
      rollback_plan: { strategy: 'noop' },
      change_type: 'constitution.revoke' as const,
      payload: { constitution_id: 'c1' },
    });
    expect(change.change_id).toBe('chg_explicit');
  });
});

// ============================================================
// applyChange tests
// ============================================================

describe('applyChange', () => {
  // --- Constitution ---

  it('applies constitution.create to empty state', () => {
    const state = makeWorldState();
    const change: WorldChange = {
      ...makeMetadata({ rollback_plan: { strategy: 'reversible', reverse_change_type: 'constitution.revoke', description: 'revoke it' } }),
      change_type: 'constitution.create',
      payload: {
        rules: [{ description: 'Be safe', enforcement: 'hard' as const, scope: ['*'] }],
        allowed_permissions: ['dispatch_task' as const],
        budget_limits: { max_cost_per_action: 5, max_cost_per_day: 50, max_cost_per_loop: 25 },
      },
    };
    const newState = applyChange(state, change);
    expect(newState.constitution).not.toBeNull();
    expect(newState.constitution!.status).toBe('active');
    expect(newState.constitution!.version).toBe(1);
    expect(newState.constitution!.rules[0].description).toBe('Be safe');
    expect(newState.constitution!.allowed_permissions).toEqual(['dispatch_task']);
  });

  it('throws on constitution.create when already has active constitution', () => {
    const state = makeWorldState({ constitution: makeConstitution() });
    const change: WorldChange = {
      ...makeMetadata(),
      change_type: 'constitution.create',
      payload: {
        rules: [{ description: 'New', enforcement: 'hard' as const, scope: ['*'] }],
        allowed_permissions: ['dispatch_task' as const],
        budget_limits: { max_cost_per_action: 5, max_cost_per_day: 50, max_cost_per_loop: 25 },
      },
    };
    expect(() => applyChange(state, change)).toThrow('already has an active constitution');
  });

  it('applies constitution.supersede', () => {
    const state = makeWorldState({ constitution: makeConstitution() });
    const change: WorldChange = {
      ...makeMetadata({ rollback_plan: { strategy: 'irreversible', reason: 'THY-01: immutable' } }),
      change_type: 'constitution.supersede',
      payload: {
        old_id: 'const_1',
        new_input: {
          rules: [{ description: 'New rule', enforcement: 'soft' as const, scope: ['*'] }],
          allowed_permissions: ['dispatch_task' as const, 'propose_law' as const],
          budget_limits: { max_cost_per_action: 20, max_cost_per_day: 200, max_cost_per_loop: 100 },
        },
      },
    };
    const newState = applyChange(state, change);
    expect(newState.constitution!.version).toBe(2);
    expect(newState.constitution!.rules[0].description).toBe('New rule');
  });

  it('applies constitution.revoke', () => {
    const state = makeWorldState({ constitution: makeConstitution() });
    const change: WorldChange = {
      ...makeMetadata({ rollback_plan: { strategy: 'irreversible', reason: 'cannot un-revoke' } }),
      change_type: 'constitution.revoke',
      payload: { constitution_id: 'const_1' },
    };
    const newState = applyChange(state, change);
    expect(newState.constitution).toBeNull();
  });

  // --- Law ---

  it('applies law.propose — adds proposed law to active_laws', () => {
    const state = makeWorldState();
    const change: WorldChange = {
      ...makeMetadata(),
      change_type: 'law.propose',
      payload: {
        chief_id: 'chief_1',
        input: {
          category: 'testing',
          content: { description: 'A new law', strategy: { approach: 'careful' } },
          evidence: { source: 'observation', reasoning: 'good idea' },
        },
      },
    };
    const newState = applyChange(state, change);
    expect(newState.active_laws).toHaveLength(1);
    expect(newState.active_laws[0].status).toBe('proposed');
    expect(newState.active_laws[0].category).toBe('testing');
  });

  it('applies law.approve — changes law status to active', () => {
    const proposedLaw = makeLaw({ id: 'law_1', status: 'proposed' });
    const state = makeWorldState({ active_laws: [proposedLaw] });
    const change: WorldChange = {
      ...makeMetadata(),
      change_type: 'law.approve',
      payload: { law_id: 'law_1' },
    };
    const newState = applyChange(state, change);
    expect(newState.active_laws[0].status).toBe('active');
    expect(newState.active_laws[0].approved_by).toBe('admin');
  });

  it('applies law.revoke — removes law from active_laws', () => {
    const state = makeWorldState({ active_laws: [makeLaw()] });
    const change: WorldChange = {
      ...makeMetadata(),
      change_type: 'law.revoke',
      payload: { law_id: 'law_1' },
    };
    const newState = applyChange(state, change);
    expect(newState.active_laws).toHaveLength(0);
  });

  it('applies law.rollback — removes law from active_laws', () => {
    const state = makeWorldState({ active_laws: [makeLaw()] });
    const change: WorldChange = {
      ...makeMetadata(),
      change_type: 'law.rollback',
      payload: { law_id: 'law_1', reason: 'Harmful' },
    };
    const newState = applyChange(state, change);
    expect(newState.active_laws).toHaveLength(0);
  });

  it('throws when approving non-existent law', () => {
    const state = makeWorldState();
    const change: WorldChange = {
      ...makeMetadata(),
      change_type: 'law.approve',
      payload: { law_id: 'nonexistent' },
    };
    expect(() => applyChange(state, change)).toThrow('Law not found');
  });

  // --- Chief ---

  it('applies chief.create — adds chief to chiefs list', () => {
    const state = makeWorldState();
    const change: WorldChange = {
      ...makeMetadata(),
      change_type: 'chief.create',
      payload: {
        name: 'New Chief',
        role: 'Architect',
        skills: [],
        permissions: ['dispatch_task' as const],
        personality: { risk_tolerance: 'moderate' as const, communication_style: 'concise' as const, decision_speed: 'deliberate' as const },
        constraints: [],
      },
    };
    const newState = applyChange(state, change);
    expect(newState.chiefs).toHaveLength(1);
    expect(newState.chiefs[0].name).toBe('New Chief');
    expect(newState.chiefs[0].status).toBe('active');
  });

  it('applies chief.update — updates chief fields and increments version', () => {
    const state = makeWorldState({ chiefs: [makeChief()] });
    const change: WorldChange = {
      ...makeMetadata(),
      change_type: 'chief.update',
      payload: { chief_id: 'chief_1', updates: { name: 'Updated Chief' } },
    };
    const newState = applyChange(state, change);
    expect(newState.chiefs[0].name).toBe('Updated Chief');
    expect(newState.chiefs[0].version).toBe(2);
  });

  it('applies chief.deactivate — removes chief from list', () => {
    const state = makeWorldState({ chiefs: [makeChief()] });
    const change: WorldChange = {
      ...makeMetadata(),
      change_type: 'chief.deactivate',
      payload: { chief_id: 'chief_1' },
    };
    const newState = applyChange(state, change);
    expect(newState.chiefs).toHaveLength(0);
  });

  // --- Skill ---

  it('applies skill.register — adds draft skill', () => {
    const state = makeWorldState();
    const change: WorldChange = {
      ...makeMetadata(),
      change_type: 'skill.register',
      payload: {
        name: 'new-skill',
        definition: {
          description: 'A skill',
          prompt_template: 'Do X',
          tools_required: [],
          constraints: [],
          examples: [],
        },
      },
    };
    const newState = applyChange(state, change);
    expect(newState.skills).toHaveLength(1);
    expect(newState.skills[0].status).toBe('draft');
    expect(newState.skills[0].name).toBe('new-skill');
  });

  it('applies skill.verify — changes skill status to verified', () => {
    const draftSkill = makeSkill({ status: 'draft', verified_at: null, verified_by: null });
    const state = makeWorldState({ skills: [draftSkill] });
    const change: WorldChange = {
      ...makeMetadata(),
      change_type: 'skill.verify',
      payload: { skill_id: 'skill_1' },
    };
    const newState = applyChange(state, change);
    expect(newState.skills[0].status).toBe('verified');
    expect(newState.skills[0].verified_by).toBe('admin');
  });

  it('applies skill.deprecate — removes skill from list', () => {
    const state = makeWorldState({ skills: [makeSkill()] });
    const change: WorldChange = {
      ...makeMetadata(),
      change_type: 'skill.deprecate',
      payload: { skill_id: 'skill_1' },
    };
    const newState = applyChange(state, change);
    expect(newState.skills).toHaveLength(0);
  });

  // --- Edge cases ---

  it('throws on village mismatch', () => {
    const state = makeWorldState();
    const change: WorldChange = {
      ...makeMetadata({ village_id: 'v_other' }),
      change_type: 'constitution.revoke',
      payload: { constitution_id: 'const_1' },
    };
    expect(() => applyChange(state, change)).toThrow('Village mismatch');
  });

  it('does not mutate original state', () => {
    const state = makeWorldState();
    const change: WorldChange = {
      ...makeMetadata(),
      change_type: 'law.propose',
      payload: {
        chief_id: 'chief_1',
        input: {
          category: 'test',
          content: { description: 'Law', strategy: {} },
          evidence: { source: 's', reasoning: 'r' },
        },
      },
    };
    const newState = applyChange(state, change);
    expect(state.active_laws).toHaveLength(0);
    expect(newState.active_laws).toHaveLength(1);
  });
});

// ============================================================
// toGovernancePatch tests
// ============================================================

describe('toGovernancePatch', () => {
  it('maps constitution.create to constitution_created', () => {
    const change: WorldChange = {
      ...makeMetadata(),
      change_type: 'constitution.create',
      payload: {
        rules: [{ description: 'r', enforcement: 'hard' as const, scope: ['*'] }],
        allowed_permissions: ['dispatch_task' as const],
        budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
      },
    };
    const patch = toGovernancePatch(change);
    expect(patch).not.toBeNull();
    expect(patch!.patch_type).toBe('constitution_created');
    expect(patch!.event_id).toMatch(/^evt_/);
    expect(patch!.source_village_id).toBe('v_test');
  });

  it('maps law.approve to law_enacted', () => {
    const change: WorldChange = {
      ...makeMetadata(),
      change_type: 'law.approve',
      payload: { law_id: 'law_1' },
    };
    const patch = toGovernancePatch(change);
    expect(patch).not.toBeNull();
    expect(patch!.patch_type).toBe('law_enacted');
  });

  it('maps law.revoke to law_repealed', () => {
    const change: WorldChange = {
      ...makeMetadata(),
      change_type: 'law.revoke',
      payload: { law_id: 'law_1' },
    };
    const patch = toGovernancePatch(change);
    expect(patch!.patch_type).toBe('law_repealed');
  });

  it('maps law.rollback to law_repealed', () => {
    const change: WorldChange = {
      ...makeMetadata(),
      change_type: 'law.rollback',
      payload: { law_id: 'law_1', reason: 'bad' },
    };
    const patch = toGovernancePatch(change);
    expect(patch!.patch_type).toBe('law_repealed');
  });

  it('returns null for chief.update', () => {
    const change: WorldChange = {
      ...makeMetadata(),
      change_type: 'chief.update',
      payload: { chief_id: 'ch1', updates: { name: 'New' } },
    };
    expect(toGovernancePatch(change)).toBeNull();
  });

  it('returns null for skill.verify', () => {
    const change: WorldChange = {
      ...makeMetadata(),
      change_type: 'skill.verify',
      payload: { skill_id: 's1' },
    };
    expect(toGovernancePatch(change)).toBeNull();
  });

  it('returns null for skill.register', () => {
    const change: WorldChange = {
      ...makeMetadata(),
      change_type: 'skill.register',
      payload: {
        name: 'my-skill',
        definition: { description: 'd', prompt_template: 'p', tools_required: [], constraints: [], examples: [] },
      },
    };
    expect(toGovernancePatch(change)).toBeNull();
  });

  it('governance patch has valid schema format', () => {
    const change: WorldChange = {
      ...makeMetadata(),
      change_type: 'constitution.supersede',
      payload: {
        old_id: 'c1',
        new_input: {
          rules: [{ description: 'r', enforcement: 'hard' as const, scope: ['*'] }],
          allowed_permissions: ['dispatch_task' as const],
          budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
        },
      },
    };
    const patch = toGovernancePatch(change);
    expect(patch).not.toBeNull();
    expect(patch!.version).toBe('governance.patch.v1');
    expect(patch!.occurred_at).toBeTruthy();
  });
});
