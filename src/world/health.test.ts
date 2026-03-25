import { describe, it, expect } from 'vitest';
import type { WorldState } from './state';
import type { Village } from '../village-manager';
import type { Constitution } from '../constitution-store';
import type { Chief } from '../chief-engine';
import type { Law } from '../law-engine';
import type { Skill } from '../skill-registry';
import type { LoopCycle } from '../schemas/loop';
import {
  computeWorldHealth,
  chiefScore,
  constitutionScore,
  lawScore,
  skillScore,
  budgetScore,
  freshnessScore,
} from './health';

// --- Test fixtures ---

const NOW = Date.parse('2026-03-16T12:00:00.000Z');
const JUST_NOW = new Date(NOW - 1000 * 60 * 5).toISOString(); // 5 minutes ago

function makeVillage(overrides?: Partial<Village>): Village {
  return {
    id: 'v-1',
    name: 'test-village',
    description: 'test',
    target_repo: 'test/repo',
    status: 'active',
    metadata: {},
    version: 1,
    created_at: JUST_NOW,
    updated_at: JUST_NOW,
    ...overrides,
  };
}

function makeConstitution(overrides?: Partial<Constitution>): Constitution {
  return {
    id: 'const-1',
    village_id: 'v-1',
    version: 1,
    status: 'active',
    created_at: JUST_NOW,
    created_by: 'human',
    rules: [],
    allowed_permissions: [],
    budget_limits: {
      max_cost_per_action: 1.0,
      max_cost_per_day: 100.0,
      max_cost_per_loop: 10.0,
      max_cost_per_month: 0,
    },
    superseded_by: null,
    ...overrides,
  };
}

function makeChief(id: string): Chief {
  return {
    id,
    village_id: 'v-1',
    name: `chief-${id}`,
    role: 'general',
    role_type: 'chief' as const,
    parent_chief_id: null,
    version: 1,
    status: 'active',
    skills: [],
    permissions: [],
    personality: { risk_tolerance: 'moderate', communication_style: 'concise', decision_speed: 'deliberate' },
    constraints: [],
    profile: null,
    budget_config: null,
    use_precedents: false,
    precedent_config: null,
    pause_reason: null,
    paused_at: null,
    pipelines: [],
    adapter_type: 'local' as const,
    context_mode: 'fat' as const,
    adapter_config: {},
    last_heartbeat_at: null,
    current_run_id: null,
    current_run_status: 'idle' as const,
    timeout_count: 0,
    created_at: JUST_NOW,
    updated_at: JUST_NOW,
  };
}

function makeLaw(id: string): Law {
  return {
    id,
    village_id: 'v-1',
    proposed_by: 'chief-1',
    approved_by: 'human',
    version: 1,
    status: 'active',
    category: 'policy',
    content: { description: 'test law', strategy: {} },
    risk_level: 'low',
    evidence: { source: 'test', reasoning: 'test' },
    effectiveness: null,
    created_at: JUST_NOW,
    updated_at: JUST_NOW,
  };
}

function makeSkill(id: string): Skill {
  return {
    id,
    name: `skill-${id}`,
    version: 1,
    status: 'verified',
    village_id: 'v-1',
    definition: {
      description: 'test skill',
      prompt_template: 'do something',
      tools_required: [],
      constraints: [],
      examples: [],
    },
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
    created_at: JUST_NOW,
    updated_at: JUST_NOW,
    verified_at: JUST_NOW,
    verified_by: 'human',
  };
}

function makeCycle(id: string, costIncurred: number): LoopCycle {
  return {
    id,
    village_id: 'v-1',
    chief_id: 'chief-1',
    trigger: 'manual',
    status: 'running',
    version: 1,
    budget_remaining: 10 - costIncurred,
    cost_incurred: costIncurred,
    iterations: 1,
    max_iterations: 10,
    timeout_ms: 60000,
    actions: [],
    laws_proposed: [],
    laws_enacted: [],
    abort_reason: null,
    intent: null,
    created_at: JUST_NOW,
    updated_at: JUST_NOW,
  };
}

function makeEmptyState(): WorldState {
  return {
    village: makeVillage(),
    constitution: null,
    chiefs: [],
    active_laws: [],
    skills: [],
    running_cycles: [],
    goals: [],
    assembled_at: JUST_NOW,
  };
}

function makeFullState(): WorldState {
  return {
    village: makeVillage(),
    constitution: makeConstitution(),
    chiefs: [makeChief('c-1'), makeChief('c-2'), makeChief('c-3')],
    active_laws: [makeLaw('l-1'), makeLaw('l-2'), makeLaw('l-3'), makeLaw('l-4'), makeLaw('l-5')],
    skills: [makeSkill('s-1'), makeSkill('s-2'), makeSkill('s-3'), makeSkill('s-4'), makeSkill('s-5')],
    running_cycles: [makeCycle('cy-1', 5)], // 5/100 = 5% utilization
    goals: [],
    assembled_at: JUST_NOW,
  };
}

// --- Sub-score unit tests ---

describe('chiefScore', () => {
  it('returns 0 for no chiefs', () => expect(chiefScore(0)).toBe(0));
  it('returns 50 for 1 chief', () => expect(chiefScore(1)).toBe(50));
  it('returns 80 for 2 chiefs', () => expect(chiefScore(2)).toBe(80));
  it('returns 100 for 3 chiefs', () => expect(chiefScore(3)).toBe(100));
  it('returns 100 for 10 chiefs', () => expect(chiefScore(10)).toBe(100));
});

describe('constitutionScore', () => {
  it('returns 0 when inactive', () => expect(constitutionScore(false)).toBe(0));
  it('returns 100 when active', () => expect(constitutionScore(true)).toBe(100));
});

describe('lawScore', () => {
  it('returns 0 for no laws', () => expect(lawScore(0)).toBe(0));
  it('returns 30 for 1 law', () => expect(lawScore(1)).toBe(30));
  it('returns 50 for 2 laws', () => expect(lawScore(2)).toBe(50));
  it('returns 70 for 3 laws', () => expect(lawScore(3)).toBe(70));
  it('returns 85 for 4 laws', () => expect(lawScore(4)).toBe(85));
  it('returns 100 for 5 laws', () => expect(lawScore(5)).toBe(100));
  it('returns 100 for 10 laws', () => expect(lawScore(10)).toBe(100));
});

describe('skillScore', () => {
  it('returns 0 for no skills', () => expect(skillScore(0)).toBe(0));
  it('returns 30 for 1 skill', () => expect(skillScore(1)).toBe(30));
  it('returns 50 for 2 skills', () => expect(skillScore(2)).toBe(50));
  it('returns 70 for 3 skills', () => expect(skillScore(3)).toBe(70));
  it('returns 85 for 4 skills', () => expect(skillScore(4)).toBe(85));
  it('returns 100 for 5+ skills', () => expect(skillScore(5)).toBe(100));
});

describe('budgetScore', () => {
  it('returns 0 when no constitution', () => expect(budgetScore(0, false)).toBe(0));
  it('returns 100 at 0% utilization', () => expect(budgetScore(0, true)).toBe(100));
  it('returns 100 at 50% utilization', () => expect(budgetScore(0.5, true)).toBe(100));
  it('returns 100 at 70% utilization', () => expect(budgetScore(0.7, true)).toBe(100));
  it('returns ~75 at 80% utilization', () => expect(budgetScore(0.8, true)).toBe(75));
  it('returns 50 at 90% utilization', () => expect(budgetScore(0.9, true)).toBe(50));
  it('returns ~25 at 95% utilization', () => expect(budgetScore(0.95, true)).toBe(25));
  it('returns 0 at 100% utilization', () => expect(budgetScore(1.0, true)).toBe(0));
  it('returns 0 when over budget', () => expect(budgetScore(1.5, true)).toBe(0));
});

describe('freshnessScore', () => {
  it('returns 100 for 0ms age', () => expect(freshnessScore(0)).toBe(100));
  it('returns 100 for 30 minutes', () => expect(freshnessScore(30 * 60 * 1000)).toBe(100));
  it('returns 80 for 3 hours', () => expect(freshnessScore(3 * 60 * 60 * 1000)).toBe(80));
  it('returns 60 for 12 hours', () => expect(freshnessScore(12 * 60 * 60 * 1000)).toBe(60));
  it('returns 30 for 48 hours', () => expect(freshnessScore(48 * 60 * 60 * 1000)).toBe(30));
  it('returns 10 for 1 week', () => expect(freshnessScore(7 * 24 * 60 * 60 * 1000)).toBe(10));
  it('returns 100 for negative age (clock skew)', () => expect(freshnessScore(-5000)).toBe(100));
});

// --- Integration tests ---

describe('computeWorldHealth', () => {
  describe('empty village (low score)', () => {
    it('returns low overall with correct field counts', () => {
      const health = computeWorldHealth(makeEmptyState(), NOW);

      expect(health.chief_count).toBe(0);
      expect(health.law_count).toBe(0);
      expect(health.skill_count).toBe(0);
      expect(health.constitution_active).toBe(false);
      expect(health.cycle_count).toBe(0);
      expect(health.budget_utilization).toBe(0);

      // Sub-scores: chief=0, const=0, law=0, skill=0, budget=0, freshness=100
      expect(health.scores.chief).toBe(0);
      expect(health.scores.constitution).toBe(0);
      expect(health.scores.law).toBe(0);
      expect(health.scores.skill).toBe(0);
      expect(health.scores.budget).toBe(0);
      expect(health.scores.freshness).toBe(100);

      // overall = 0*0.20 + 0*0.20 + 0*0.15 + 0*0.15 + 0*0.15 + 100*0.15 = 15
      expect(health.overall).toBe(15);
    });
  });

  describe('full market village (high score)', () => {
    it('returns high overall with all dimensions healthy', () => {
      const health = computeWorldHealth(makeFullState(), NOW);

      expect(health.chief_count).toBe(3);
      expect(health.law_count).toBe(5);
      expect(health.skill_count).toBe(5);
      expect(health.constitution_active).toBe(true);
      expect(health.cycle_count).toBe(1);
      expect(health.budget_utilization).toBeCloseTo(0.05); // 5/100

      // All sub-scores should be high
      expect(health.scores.chief).toBe(100);
      expect(health.scores.constitution).toBe(100);
      expect(health.scores.law).toBe(100);
      expect(health.scores.skill).toBe(100);
      expect(health.scores.budget).toBe(100);
      expect(health.scores.freshness).toBe(100);

      // overall = 100*0.20 + 100*0.20 + 100*0.15 + 100*0.15 + 100*0.15 + 100*0.15 = 100
      expect(health.overall).toBe(100);
    });
  });

  describe('now parameter affects freshness', () => {
    it('same state with different now yields different freshness', () => {
      const state = makeFullState();
      const recent = computeWorldHealth(state, NOW);
      // 48 hours later
      const later = computeWorldHealth(state, NOW + 48 * 60 * 60 * 1000);

      expect(recent.scores.freshness).toBe(100);
      expect(later.scores.freshness).toBe(30);
      expect(later.overall).toBeLessThan(recent.overall);
    });
  });

  describe('pure function guarantee', () => {
    it('returns identical output for identical input', () => {
      const state = makeFullState();
      const result1 = computeWorldHealth(state, NOW);
      const result2 = computeWorldHealth(state, NOW);
      expect(result1).toEqual(result2);
    });
  });

  describe('budget utilization edge cases', () => {
    it('handles no constitution with running cycles', () => {
      const state = makeEmptyState();
      state.running_cycles = [makeCycle('cy-1', 50)];
      const health = computeWorldHealth(state, NOW);

      // No constitution → budget_utilization = 0, budget_score = 0
      expect(health.budget_utilization).toBe(0);
      expect(health.scores.budget).toBe(0);
    });

    it('handles high budget utilization', () => {
      const state = makeFullState();
      // cost_incurred = 95 vs daily budget = 100 → 95%
      state.running_cycles = [makeCycle('cy-1', 95)];
      const health = computeWorldHealth(state, NOW);

      expect(health.budget_utilization).toBeCloseTo(0.95);
      expect(health.scores.budget).toBe(25);
    });

    it('handles over-budget utilization', () => {
      const state = makeFullState();
      state.running_cycles = [makeCycle('cy-1', 150)];
      const health = computeWorldHealth(state, NOW);

      expect(health.budget_utilization).toBeCloseTo(1.5);
      expect(health.scores.budget).toBe(0);
    });
  });

  describe('last_change_age_ms', () => {
    it('computes correct age from village.updated_at', () => {
      const state = makeEmptyState();
      // village.updated_at is JUST_NOW (5 minutes before NOW)
      const health = computeWorldHealth(state, NOW);
      expect(health.last_change_age_ms).toBe(NOW - Date.parse(JUST_NOW));
    });

    it('handles negative age (clock skew) gracefully', () => {
      const state = makeEmptyState();
      // now is before updated_at → negative age → freshness clamps to 100
      const health = computeWorldHealth(state, NOW - 10 * 60 * 1000);
      expect(health.scores.freshness).toBe(100);
    });
  });

  describe('partial village states', () => {
    it('village with constitution but nothing else', () => {
      const state = makeEmptyState();
      state.constitution = makeConstitution();
      const health = computeWorldHealth(state, NOW);

      expect(health.scores.constitution).toBe(100);
      expect(health.scores.chief).toBe(0);
      expect(health.scores.budget).toBe(100); // has constitution, 0 utilization
      // overall = 0*0.20 + 100*0.20 + 0*0.15 + 0*0.15 + 100*0.15 + 100*0.15 = 50
      expect(health.overall).toBe(50);
    });

    it('village with 1 chief and 1 law', () => {
      const state = makeEmptyState();
      state.constitution = makeConstitution();
      state.chiefs = [makeChief('c-1')];
      state.active_laws = [makeLaw('l-1')];
      const health = computeWorldHealth(state, NOW);

      expect(health.scores.chief).toBe(50);       // 1 chief
      expect(health.scores.constitution).toBe(100);
      expect(health.scores.law).toBe(30);          // 1 law
      expect(health.scores.skill).toBe(0);
      expect(health.scores.budget).toBe(100);      // 0 utilization
      expect(health.scores.freshness).toBe(100);
      // overall = 50*0.20 + 100*0.20 + 30*0.15 + 0*0.15 + 100*0.15 + 100*0.15 = 64.5 → 65
      expect(health.overall).toBe(65);
    });
  });
});
