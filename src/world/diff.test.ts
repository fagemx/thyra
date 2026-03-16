import { describe, it, expect } from 'vitest';
import { diffWorldState } from './diff';
import type { WorldState } from './state';
import type { Village } from '../village-manager';
import type { Constitution } from '../constitution-store';
import type { Chief } from '../chief-engine';
import type { Law } from '../law-engine';
import type { Skill } from '../skill-registry';
import type { LoopCycle } from '../loop-runner';

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
    rules: [{ id: 'rule-1', description: 'Rule 1', enforcement: 'hard', scope: ['all'] }],
    allowed_permissions: ['dispatch_task', 'propose_law'],
    budget_limits: { max_cost_per_action: 1, max_cost_per_day: 10, max_cost_per_loop: 5 },
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
    permissions: ['dispatch_task'],
    personality: { risk_tolerance: 'moderate', communication_style: 'concise', decision_speed: 'deliberate' },
    constraints: [],
    profile: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeLaw(overrides: Partial<Law> = {}): Law {
  return {
    id: 'law-1',
    village_id: 'village-1',
    proposed_by: 'chief-1',
    approved_by: null,
    version: 1,
    status: 'active',
    category: 'testing',
    content: { description: 'Always write tests', strategy: { min_coverage: 80 } },
    risk_level: 'low',
    evidence: { source: 'observation', reasoning: 'Tests improve quality' },
    effectiveness: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: 'skill-1',
    name: 'code-review',
    version: 1,
    status: 'verified',
    village_id: 'village-1',
    definition: {
      description: 'Reviews code',
      prompt_template: 'Review the following code: {{code}}',
      tools_required: [],
      constraints: [],
      examples: [],
    },
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    verified_at: '2026-01-01T00:00:00Z',
    verified_by: 'human',
    content: null,
    source_type: 'system',
    source_origin: null,
    source_author: null,
    forked_from: null,
    scope_type: 'global',
    team_id: null,
    tags: [],
    used_count: 0,
    last_used_at: null,
    ...overrides,
  };
}

function makeCycle(overrides: Partial<LoopCycle> = {}): LoopCycle {
  return {
    id: 'cycle-1',
    village_id: 'village-1',
    chief_id: 'chief-1',
    trigger: 'manual',
    status: 'running',
    version: 1,
    budget_remaining: 10,
    cost_incurred: 0,
    iterations: 0,
    max_iterations: 5,
    timeout_ms: 30000,
    actions: [],
    laws_proposed: [],
    laws_enacted: [],
    abort_reason: null,
    intent: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeWorldState(overrides: Partial<WorldState> = {}): WorldState {
  return {
    village: makeVillage(),
    constitution: makeConstitution(),
    chiefs: [makeChief()],
    active_laws: [makeLaw()],
    skills: [makeSkill()],
    running_cycles: [],
    assembled_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('diffWorldState', () => {
  // 1. identical states → empty diff
  it('returns has_changes=false for identical states', () => {
    const state = makeWorldState();
    const diff = diffWorldState(state, state);

    expect(diff.has_changes).toBe(false);
    expect(diff.village_id).toBe('village-1');
    expect(diff.village).toBeNull();
    expect(diff.constitution).toBeNull();
    expect(diff.chiefs.added).toHaveLength(0);
    expect(diff.chiefs.removed).toHaveLength(0);
    expect(diff.chiefs.changed).toHaveLength(0);
    expect(diff.laws.added).toHaveLength(0);
    expect(diff.laws.removed).toHaveLength(0);
    expect(diff.laws.changed).toHaveLength(0);
    expect(diff.skills.added).toHaveLength(0);
    expect(diff.skills.removed).toHaveLength(0);
    expect(diff.skills.changed).toHaveLength(0);
    expect(diff.loops.added).toHaveLength(0);
    expect(diff.loops.removed).toHaveLength(0);
  });

  // 2. village name changed
  it('detects village name change', () => {
    const before = makeWorldState();
    const after = makeWorldState({
      village: makeVillage({ name: 'Renamed Village' }),
    });

    const diff = diffWorldState(before, after);
    expect(diff.has_changes).toBe(true);
    expect(diff.village).not.toBeNull();
    expect(diff.village!.fields_changed).toContain('name');
    expect(diff.village!.fields_changed).not.toContain('status');
  });

  // 3. constitution superseded
  it('detects constitution superseded', () => {
    const before = makeWorldState();
    const after = makeWorldState({
      constitution: makeConstitution({
        id: 'const-2',
        version: 2,
        rules: [{ id: 'rule-2', description: 'New Rule', enforcement: 'soft', scope: ['all'] }],
      }),
    });

    const diff = diffWorldState(before, after);
    expect(diff.has_changes).toBe(true);
    expect(diff.constitution).not.toBeNull();
    expect(diff.constitution!.action).toBe('superseded');
    expect(diff.constitution!.before_id).toBe('const-1');
    expect(diff.constitution!.after_id).toBe('const-2');
    expect(diff.constitution!.fingerprint_before).not.toBeNull();
    expect(diff.constitution!.fingerprint_after).not.toBeNull();
    expect(diff.constitution!.fingerprint_before).not.toBe(diff.constitution!.fingerprint_after);
  });

  // 4. constitution created (before=null)
  it('detects constitution created', () => {
    const before = makeWorldState({ constitution: null });
    const after = makeWorldState();

    const diff = diffWorldState(before, after);
    expect(diff.has_changes).toBe(true);
    expect(diff.constitution!.action).toBe('created');
    expect(diff.constitution!.before_id).toBeNull();
    expect(diff.constitution!.after_id).toBe('const-1');
    expect(diff.constitution!.fingerprint_before).toBeNull();
    expect(diff.constitution!.fingerprint_after).not.toBeNull();
  });

  // 5. constitution revoked (after=null)
  it('detects constitution revoked', () => {
    const before = makeWorldState();
    const after = makeWorldState({ constitution: null });

    const diff = diffWorldState(before, after);
    expect(diff.has_changes).toBe(true);
    expect(diff.constitution!.action).toBe('revoked');
    expect(diff.constitution!.before_id).toBe('const-1');
    expect(diff.constitution!.after_id).toBeNull();
  });

  // 6. chief created (added)
  it('detects chief added', () => {
    const before = makeWorldState({ chiefs: [] });
    const after = makeWorldState();

    const diff = diffWorldState(before, after);
    expect(diff.has_changes).toBe(true);
    expect(diff.chiefs.added).toHaveLength(1);
    expect(diff.chiefs.added[0].id).toBe('chief-1');
    expect(diff.chiefs.added[0].name).toBe('Alpha');
  });

  // 7. chief deactivated (removed)
  it('detects chief removed', () => {
    const before = makeWorldState();
    const after = makeWorldState({ chiefs: [] });

    const diff = diffWorldState(before, after);
    expect(diff.has_changes).toBe(true);
    expect(diff.chiefs.removed).toHaveLength(1);
    expect(diff.chiefs.removed[0].id).toBe('chief-1');
  });

  // 8. chief permissions changed
  it('detects chief permissions changed', () => {
    const before = makeWorldState();
    const after = makeWorldState({
      chiefs: [makeChief({ permissions: ['dispatch_task', 'propose_law'] })],
    });

    const diff = diffWorldState(before, after);
    expect(diff.has_changes).toBe(true);
    expect(diff.chiefs.changed).toHaveLength(1);
    expect(diff.chiefs.changed[0].fields_changed).toContain('permissions');
  });

  // 9. law added
  it('detects law added', () => {
    const before = makeWorldState({ active_laws: [] });
    const after = makeWorldState();

    const diff = diffWorldState(before, after);
    expect(diff.has_changes).toBe(true);
    expect(diff.laws.added).toHaveLength(1);
    expect(diff.laws.added[0].id).toBe('law-1');
    expect(diff.laws.added[0].category).toBe('testing');
  });

  // 10. law removed
  it('detects law removed', () => {
    const before = makeWorldState();
    const after = makeWorldState({ active_laws: [] });

    const diff = diffWorldState(before, after);
    expect(diff.has_changes).toBe(true);
    expect(diff.laws.removed).toHaveLength(1);
    expect(diff.laws.removed[0].id).toBe('law-1');
  });

  // 11. law content changed
  it('detects law content changed', () => {
    const before = makeWorldState();
    const after = makeWorldState({
      active_laws: [makeLaw({
        content: { description: 'Updated test rule', strategy: { min_coverage: 90 } },
      })],
    });

    const diff = diffWorldState(before, after);
    expect(diff.has_changes).toBe(true);
    expect(diff.laws.changed).toHaveLength(1);
    expect(diff.laws.changed[0].fields).toContain('content');
  });

  // 12. skill added
  it('detects skill added', () => {
    const before = makeWorldState({ skills: [] });
    const after = makeWorldState();

    const diff = diffWorldState(before, after);
    expect(diff.has_changes).toBe(true);
    expect(diff.skills.added).toHaveLength(1);
    expect(diff.skills.added[0].id).toBe('skill-1');
    expect(diff.skills.added[0].name).toBe('code-review');
  });

  // 13. skill removed
  it('detects skill removed', () => {
    const before = makeWorldState();
    const after = makeWorldState({ skills: [] });

    const diff = diffWorldState(before, after);
    expect(diff.has_changes).toBe(true);
    expect(diff.skills.removed).toHaveLength(1);
    expect(diff.skills.removed[0].id).toBe('skill-1');
  });

  // 14. loop cycle changed
  it('detects loop cycle added', () => {
    const before = makeWorldState();
    const after = makeWorldState({ running_cycles: [makeCycle()] });

    const diff = diffWorldState(before, after);
    expect(diff.has_changes).toBe(true);
    expect(diff.loops.added).toHaveLength(1);
    expect(diff.loops.added[0]).toBe('cycle-1');
  });

  // 15. cross-village diff throws
  it('throws on cross-village diff', () => {
    const before = makeWorldState();
    const after = makeWorldState({
      village: makeVillage({ id: 'village-2' }),
    });

    expect(() => diffWorldState(before, after)).toThrow(
      'Cannot diff WorldState across different villages',
    );
  });

  // 16. multiple domains changed simultaneously
  it('detects multiple domains changed at once', () => {
    const before = makeWorldState();
    const after = makeWorldState({
      village: makeVillage({ status: 'paused' }),
      constitution: makeConstitution({
        id: 'const-2',
        version: 2,
        rules: [{ id: 'rule-3', description: 'Updated', enforcement: 'soft', scope: ['code'] }],
      }),
      active_laws: [
        makeLaw(),
        makeLaw({ id: 'law-2', category: 'security' }),
      ],
    });

    const diff = diffWorldState(before, after);
    expect(diff.has_changes).toBe(true);
    expect(diff.village).not.toBeNull();
    expect(diff.village!.fields_changed).toContain('status');
    expect(diff.constitution).not.toBeNull();
    expect(diff.constitution!.action).toBe('superseded');
    expect(diff.laws.added).toHaveLength(1);
    expect(diff.laws.added[0].category).toBe('security');
  });
});
