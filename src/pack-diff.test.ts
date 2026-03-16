import { describe, it, expect } from 'vitest';
import {
  canonicalizeConstitution,
  constitutionFingerprint,
  diffConstitution,
  diffChief,
  diffLaws,
} from './pack-diff';
import type { Constitution } from './constitution-store';
import type { Chief } from './chief-engine';
import type { Law } from './law-engine';
import type { VillagePackConstitution, VillagePackChief, VillagePackLaw } from './schemas/village-pack';
import type { SkillBinding } from './schemas/skill';

// ---------------------------------------------------------------------------
// Test helpers — minimal objects with only fields needed for diff
// ---------------------------------------------------------------------------

function makeYamlConstitution(overrides?: Partial<VillagePackConstitution>): VillagePackConstitution {
  return {
    rules: [
      { description: 'must not fabricate sources', enforcement: 'hard', scope: ['*'] },
    ],
    allowed_permissions: ['dispatch_task', 'propose_law'],
    budget: { max_cost_per_action: 0.5, max_cost_per_day: 10, max_cost_per_loop: 2 },
    ...overrides,
  };
}

function makeDbConstitution(overrides?: Partial<Constitution>): Constitution {
  return {
    id: 'c-001',
    village_id: 'v-001',
    version: 1,
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    created_by: 'human',
    rules: [
      { id: 'r-001', description: 'must not fabricate sources', enforcement: 'hard', scope: ['*'] },
    ],
    allowed_permissions: ['dispatch_task', 'propose_law'],
    budget_limits: { max_cost_per_action: 0.5, max_cost_per_day: 10, max_cost_per_loop: 2 },
    superseded_by: null,
    ...overrides,
  };
}

function makeYamlChief(overrides?: Partial<VillagePackChief>): VillagePackChief {
  return {
    name: 'blog-chief',
    role: 'content-lead',
    personality: { risk_tolerance: 'conservative', communication_style: 'concise', decision_speed: 'deliberate' },
    constraints: [{ type: 'must', description: 'verify all sources' }],
    permissions: ['dispatch_task', 'propose_law'],
    pipelines: [],
    ...overrides,
  };
}

function makeDbChief(overrides?: Partial<Chief>): Chief {
  return {
    id: 'ch-001',
    village_id: 'v-001',
    name: 'blog-chief',
    role: 'content-lead',
    version: 1,
    status: 'active',
    skills: [],
    pipelines: [],
    permissions: ['dispatch_task', 'propose_law'],
    personality: { risk_tolerance: 'conservative', communication_style: 'concise', decision_speed: 'deliberate' },
    constraints: [{ type: 'must', description: 'verify all sources' }],
    profile: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeYamlLaw(overrides?: Partial<VillagePackLaw>): VillagePackLaw {
  return {
    category: 'content-quality',
    content: { description: 'articles must cite sources', strategy: { min_sources: 2 } },
    evidence: { source: 'editorial-policy', reasoning: 'quality standards' },
    ...overrides,
  };
}

function makeDbLaw(overrides?: Partial<Law>): Law {
  return {
    id: 'law-001',
    village_id: 'v-001',
    proposed_by: 'human',
    approved_by: 'human',
    version: 1,
    status: 'active',
    category: 'content-quality',
    content: { description: 'articles must cite sources', strategy: { min_sources: 2 } },
    risk_level: 'low',
    evidence: { source: 'editorial-policy', reasoning: 'quality standards' },
    effectiveness: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// ===========================================================================
// Constitution Fingerprint Tests
// ===========================================================================

describe('constitutionFingerprint', () => {
  const base = {
    rules: [{ description: 'must not fabricate sources', enforcement: 'hard', scope: ['*'] }],
    allowed_permissions: ['read_file', 'write_file'],
    budget: { max_cost_per_action: 0.5, max_cost_per_day: 10, max_cost_per_loop: 2 },
  };

  it('same content, different rule order → same fingerprint', () => {
    const a = {
      ...base,
      rules: [
        { description: 'rule A', enforcement: 'hard', scope: ['*'] },
        { description: 'rule B', enforcement: 'soft', scope: ['*'] },
      ],
    };
    const b = {
      ...base,
      rules: [
        { description: 'rule B', enforcement: 'soft', scope: ['*'] },
        { description: 'rule A', enforcement: 'hard', scope: ['*'] },
      ],
    };
    expect(constitutionFingerprint(a)).toBe(constitutionFingerprint(b));
  });

  it('same content, different description casing → same fingerprint', () => {
    const a = { ...base, rules: [{ description: 'Must Not Fabricate', enforcement: 'hard', scope: ['*'] }] };
    const b = { ...base, rules: [{ description: 'must not fabricate', enforcement: 'hard', scope: ['*'] }] };
    expect(constitutionFingerprint(a)).toBe(constitutionFingerprint(b));
  });

  it('same content, extra whitespace in description → same fingerprint', () => {
    const a = { ...base, rules: [{ description: '  must not fabricate  ', enforcement: 'hard', scope: ['*'] }] };
    const b = { ...base, rules: [{ description: 'must not fabricate', enforcement: 'hard', scope: ['*'] }] };
    expect(constitutionFingerprint(a)).toBe(constitutionFingerprint(b));
  });

  it('same content, different rule id → same fingerprint (id ignored)', () => {
    const withId = {
      ...base,
      rules: [{ id: 'R-001', description: 'must not fabricate', enforcement: 'hard', scope: ['*'] } as { description: string; enforcement: string; scope: string[] }],
    };
    const noId = {
      ...base,
      rules: [{ description: 'must not fabricate', enforcement: 'hard', scope: ['*'] }],
    };
    expect(constitutionFingerprint(withId)).toBe(constitutionFingerprint(noId));
  });

  it('different enforcement (hard→soft) → different fingerprint', () => {
    const a = { ...base, rules: [{ description: 'rule', enforcement: 'hard', scope: ['*'] }] };
    const b = { ...base, rules: [{ description: 'rule', enforcement: 'soft', scope: ['*'] }] };
    expect(constitutionFingerprint(a)).not.toBe(constitutionFingerprint(b));
  });

  it('different budget value → different fingerprint', () => {
    const a = { ...base };
    const b = { ...base, budget: { ...base.budget, max_cost_per_day: 20 } };
    expect(constitutionFingerprint(a)).not.toBe(constitutionFingerprint(b));
  });

  it('added permission → different fingerprint', () => {
    const a = { ...base };
    const b = { ...base, allowed_permissions: ['read_file', 'write_file', 'execute'] };
    expect(constitutionFingerprint(a)).not.toBe(constitutionFingerprint(b));
  });

  it('removed permission → different fingerprint', () => {
    const a = { ...base };
    const b = { ...base, allowed_permissions: ['read_file'] };
    expect(constitutionFingerprint(a)).not.toBe(constitutionFingerprint(b));
  });

  it('added rule → different fingerprint', () => {
    const a = { ...base };
    const b = {
      ...base,
      rules: [...base.rules, { description: 'new rule', enforcement: 'soft', scope: ['*'] }],
    };
    expect(constitutionFingerprint(a)).not.toBe(constitutionFingerprint(b));
  });

  it('different scope order → same fingerprint', () => {
    const a = { ...base, rules: [{ description: 'rule', enforcement: 'hard', scope: ['a', 'b'] }] };
    const b = { ...base, rules: [{ description: 'rule', enforcement: 'hard', scope: ['b', 'a'] }] };
    expect(constitutionFingerprint(a)).toBe(constitutionFingerprint(b));
  });

  it('different permission order → same fingerprint', () => {
    const a = { ...base, allowed_permissions: ['write_file', 'read_file'] };
    const b = { ...base, allowed_permissions: ['read_file', 'write_file'] };
    expect(constitutionFingerprint(a)).toBe(constitutionFingerprint(b));
  });

  it('returns 16-char hex string', () => {
    const fp = constitutionFingerprint(base);
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('canonicalizeConstitution', () => {
  it('produces deterministic JSON', () => {
    const input = {
      rules: [{ description: '  Rule A  ', enforcement: 'hard', scope: ['b', 'a'] }],
      allowed_permissions: ['z', 'a'],
      budget: { max_cost_per_action: 1, max_cost_per_day: 10, max_cost_per_loop: 5 },
    };
    const result = JSON.parse(canonicalizeConstitution(input));
    expect(result.rules[0].description).toBe('rule a');
    expect(result.rules[0].scope).toEqual(['a', 'b']);
    expect(result.allowed_permissions).toEqual(['a', 'z']);
  });
});

// ===========================================================================
// diffConstitution Tests
// ===========================================================================

describe('diffConstitution', () => {
  it('null current → create', () => {
    expect(diffConstitution(makeYamlConstitution(), null)).toBe('create');
  });

  it('identical → skip', () => {
    expect(diffConstitution(makeYamlConstitution(), makeDbConstitution())).toBe('skip');
  });

  it('changed rule enforcement → supersede', () => {
    const yaml = makeYamlConstitution({
      rules: [{ description: 'must not fabricate sources', enforcement: 'soft', scope: ['*'] }],
    });
    expect(diffConstitution(yaml, makeDbConstitution())).toBe('supersede');
  });

  it('changed budget → supersede', () => {
    const yaml = makeYamlConstitution({
      budget: { max_cost_per_action: 1.0, max_cost_per_day: 10, max_cost_per_loop: 2 },
    });
    expect(diffConstitution(yaml, makeDbConstitution())).toBe('supersede');
  });

  it('changed permissions → supersede', () => {
    const yaml = makeYamlConstitution({
      allowed_permissions: ['dispatch_task', 'propose_law', 'query_edda'],
    });
    expect(diffConstitution(yaml, makeDbConstitution())).toBe('supersede');
  });

  it('cosmetic change only (whitespace/case) → skip', () => {
    const yaml = makeYamlConstitution({
      rules: [{ description: '  Must Not Fabricate Sources  ', enforcement: 'hard', scope: ['*'] }],
    });
    expect(diffConstitution(yaml, makeDbConstitution())).toBe('skip');
  });
});

// ===========================================================================
// diffChief Tests
// ===========================================================================

describe('diffChief', () => {
  const emptySkills: SkillBinding[] = [];

  it('null current → create', () => {
    expect(diffChief(makeYamlChief(), null, emptySkills)).toBe('create');
  });

  it('identical → skip', () => {
    expect(diffChief(makeYamlChief(), makeDbChief(), emptySkills)).toBe('skip');
  });

  it('changed name → update', () => {
    const yaml = makeYamlChief({ name: 'new-chief' });
    expect(diffChief(yaml, makeDbChief(), emptySkills)).toBe('update');
  });

  it('changed role → update', () => {
    const yaml = makeYamlChief({ role: 'editor' });
    expect(diffChief(yaml, makeDbChief(), emptySkills)).toBe('update');
  });

  it('changed personality → update', () => {
    const yaml = makeYamlChief({
      personality: { risk_tolerance: 'aggressive', communication_style: 'concise', decision_speed: 'deliberate' },
    });
    expect(diffChief(yaml, makeDbChief(), emptySkills)).toBe('update');
  });

  it('changed constraints → update', () => {
    const yaml = makeYamlChief({
      constraints: [{ type: 'must_not', description: 'never skip review' }],
    });
    expect(diffChief(yaml, makeDbChief(), emptySkills)).toBe('update');
  });

  it('reordered permissions → skip (sameSet)', () => {
    const yaml = makeYamlChief({ permissions: ['propose_law', 'dispatch_task'] });
    expect(diffChief(yaml, makeDbChief(), emptySkills)).toBe('skip');
  });

  it('added permission → update', () => {
    const yaml = makeYamlChief({ permissions: ['dispatch_task', 'propose_law', 'query_edda'] });
    expect(diffChief(yaml, makeDbChief(), emptySkills)).toBe('update');
  });

  it('changed skills → update', () => {
    const resolvedSkills: SkillBinding[] = [{ skill_id: 'sk-001', skill_version: 1 }];
    expect(diffChief(makeYamlChief(), makeDbChief(), resolvedSkills)).toBe('update');
  });

  it('same skills different order → skip', () => {
    const skills: SkillBinding[] = [
      { skill_id: 'sk-002', skill_version: 1 },
      { skill_id: 'sk-001', skill_version: 2 },
    ];
    const dbChief = makeDbChief({
      skills: [
        { skill_id: 'sk-001', skill_version: 2 },
        { skill_id: 'sk-002', skill_version: 1 },
      ],
    });
    expect(diffChief(makeYamlChief(), dbChief, skills)).toBe('skip');
  });

  it('skill version change → update', () => {
    const resolvedSkills: SkillBinding[] = [{ skill_id: 'sk-001', skill_version: 2 }];
    const dbChief = makeDbChief({
      skills: [{ skill_id: 'sk-001', skill_version: 1 }],
    });
    expect(diffChief(makeYamlChief(), dbChief, resolvedSkills)).toBe('update');
  });
});

// ===========================================================================
// diffLaws Tests
// ===========================================================================

describe('diffLaws', () => {
  it('empty both → no changes', () => {
    const result = diffLaws([], []);
    expect(result.toPropose).toEqual([]);
    expect(result.toRevoke).toEqual([]);
    expect(result.toReplace).toEqual([]);
  });

  it('new law in YAML → toPropose', () => {
    const yamlLaw = makeYamlLaw({ category: 'new-category' });
    const result = diffLaws([yamlLaw], []);
    expect(result.toPropose).toHaveLength(1);
    expect(result.toPropose[0].category).toBe('new-category');
    expect(result.toRevoke).toEqual([]);
    expect(result.toReplace).toEqual([]);
  });

  it('active law not in YAML → toRevoke', () => {
    const dbLaw = makeDbLaw({ category: 'old-category' });
    const result = diffLaws([], [dbLaw]);
    expect(result.toRevoke).toHaveLength(1);
    expect(result.toRevoke[0].category).toBe('old-category');
    expect(result.toPropose).toEqual([]);
    expect(result.toReplace).toEqual([]);
  });

  it('same category, same content → skip (empty results)', () => {
    const yamlLaw = makeYamlLaw();
    const dbLaw = makeDbLaw();
    const result = diffLaws([yamlLaw], [dbLaw]);
    expect(result.toPropose).toEqual([]);
    expect(result.toRevoke).toEqual([]);
    expect(result.toReplace).toEqual([]);
  });

  it('same category, different content → toReplace', () => {
    const yamlLaw = makeYamlLaw({
      content: { description: 'updated description', strategy: { min_sources: 3 } },
    });
    const dbLaw = makeDbLaw();
    const result = diffLaws([yamlLaw], [dbLaw]);
    expect(result.toReplace).toHaveLength(1);
    expect(result.toReplace[0].old.id).toBe('law-001');
    expect(result.toReplace[0].new.content.description).toBe('updated description');
    expect(result.toPropose).toEqual([]);
    expect(result.toRevoke).toEqual([]);
  });

  it('mixed scenario: 1 new, 1 revoke, 1 replace, 1 skip', () => {
    const yamlLaws: VillagePackLaw[] = [
      makeYamlLaw({ category: 'keep-same' }),                                                    // skip
      makeYamlLaw({ category: 'changed', content: { description: 'new', strategy: {} } }),        // replace
      makeYamlLaw({ category: 'brand-new' }),                                                     // propose
    ];
    const activeLaws: Law[] = [
      makeDbLaw({ id: 'law-keep', category: 'keep-same' }),                                       // skip
      makeDbLaw({ id: 'law-changed', category: 'changed' }),                                      // replace
      makeDbLaw({ id: 'law-removed', category: 'removed' }),                                      // revoke
    ];

    const result = diffLaws(yamlLaws, activeLaws);

    expect(result.toPropose).toHaveLength(1);
    expect(result.toPropose[0].category).toBe('brand-new');

    expect(result.toRevoke).toHaveLength(1);
    expect(result.toRevoke[0].category).toBe('removed');

    expect(result.toReplace).toHaveLength(1);
    expect(result.toReplace[0].old.category).toBe('changed');
    expect(result.toReplace[0].new.content.description).toBe('new');
  });

  it('multiple new laws → all in toPropose', () => {
    const yamlLaws: VillagePackLaw[] = [
      makeYamlLaw({ category: 'cat-a' }),
      makeYamlLaw({ category: 'cat-b' }),
    ];
    const result = diffLaws(yamlLaws, []);
    expect(result.toPropose).toHaveLength(2);
  });

  it('multiple active laws removed → all in toRevoke', () => {
    const activeLaws: Law[] = [
      makeDbLaw({ id: 'law-a', category: 'cat-a' }),
      makeDbLaw({ id: 'law-b', category: 'cat-b' }),
    ];
    const result = diffLaws([], activeLaws);
    expect(result.toRevoke).toHaveLength(2);
  });
});
