import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { initSchema } from './db';
import { WorldManager } from './world-manager';
import { VillageManager, type Village } from './village-manager';
import { ConstitutionStore } from './constitution-store';
import { ChiefEngine, type Chief } from './chief-engine';
import { SkillRegistry } from './skill-registry';
import type { WorldState } from './world/state';
import {
  economyStrategy,
  eventStrategy,
  safetyStrategy,
  loreStrategy,
  growthStrategy,
  resolveStrategy,
  shouldPropose,
  makeChiefDecision,
  executeChiefCycle,
  type ChiefProposal,
} from './chief-autonomy';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function setup() {
  const db = new Database(':memory:');
  initSchema(db);
  const vm = new VillageManager(db);
  const cs = new ConstitutionStore(db);
  const sr = new SkillRegistry(db);
  const ce = new ChiefEngine(db, cs, sr);
  const wm = new WorldManager(db);
  return { db, vm, cs, ce, sr, wm };
}

function createVillage(vm: VillageManager): Village {
  return vm.create({
    name: 'Autonomy Test Village',
    target_repo: 'test/repo',
  }, 'test-actor');
}

function createConstitution(cs: ConstitutionStore, villageId: string) {
  return cs.create(villageId, {
    rules: [{ id: 'r1', description: 'test rule', enforcement: 'hard' as const }],
    allowed_permissions: ['dispatch_task', 'enact_law_low'],
    budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
  }, 'test-actor');
}

function createChief(
  ce: ChiefEngine,
  villageId: string,
  overrides?: Partial<{ name: string; role: string; personality: Chief['personality'] }>,
): Chief {
  return ce.create(villageId, {
    name: overrides?.name ?? 'TestChief',
    role: overrides?.role ?? 'operator',
    permissions: ['dispatch_task'],
    skills: [],
    personality: overrides?.personality,
  }, 'test-actor');
}

/** 組裝一個最小 WorldState（用於 pure function 測試） */
function makeMinimalState(overrides?: Partial<WorldState>): WorldState {
  return {
    village: {
      id: 'v-test',
      name: 'Test Village',
      description: 'A test village',
      target_repo: 'test/repo',
      status: 'active' as const,
      metadata: {},
      version: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    constitution: {
      id: 'c-test',
      village_id: 'v-test',
      version: 1,
      status: 'active' as const,
      created_at: new Date().toISOString(),
      created_by: 'test',
      rules: [{ id: 'r1', description: 'test', enforcement: 'hard' as const, scope: ['*'] }],
      allowed_permissions: ['dispatch_task', 'enact_law_low'],
      budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
      superseded_by: null,
    },
    chiefs: [],
    active_laws: [],
    skills: [],
    running_cycles: [],
    assembled_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeChief(overrides?: Partial<Chief>): Chief {
  return {
    id: 'chief-test',
    village_id: 'v-test',
    name: 'TestChief',
    role: 'economy advisor',
    version: 1,
    status: 'active' as const,
    skills: [],
    permissions: ['dispatch_task'],
    personality: { risk_tolerance: 'moderate', communication_style: 'concise', decision_speed: 'deliberate' },
    constraints: [],
    profile: null,
    pipelines: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// A. Strategy Tests (pure function, no DB)
// ---------------------------------------------------------------------------

describe('economyStrategy', () => {
  it('should return budget.adjust when running cycles exist', () => {
    const chief = makeChief({ role: 'economy advisor' });
    const state = makeMinimalState({
      running_cycles: [{
        id: 'cycle-1', village_id: 'v-test', chief_id: 'chief-test',
        trigger: 'manual' as const, status: 'running' as const, version: 1,
        budget_remaining: 50, cost_incurred: 0, iterations: 0,
        max_iterations: 10, timeout_ms: 30000, actions: [], laws_proposed: [],
        laws_enacted: [], abort_reason: null, intent: null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }],
    });

    const proposals = economyStrategy(chief, state);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].change.type).toBe('budget.adjust');
    if (proposals[0].change.type === 'budget.adjust') {
      expect(proposals[0].change.max_cost_per_action).toBe(8); // 10 * 0.8
    }
    expect(proposals[0].confidence).toBe(0.7);
  });

  it('should return [] when no running cycles', () => {
    const chief = makeChief({ role: 'economy advisor' });
    const state = makeMinimalState();
    const proposals = economyStrategy(chief, state);
    expect(proposals).toHaveLength(0);
  });

  it('should return [] when no constitution', () => {
    const chief = makeChief({ role: 'economy advisor' });
    const state = makeMinimalState({ constitution: null });
    const proposals = economyStrategy(chief, state);
    expect(proposals).toHaveLength(0);
  });
});

describe('eventStrategy', () => {
  it('should return law.propose when active_laws < 3', () => {
    const chief = makeChief({ role: 'event coordinator' });
    const state = makeMinimalState({ active_laws: [] });

    const proposals = eventStrategy(chief, state);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].change.type).toBe('law.propose');
    if (proposals[0].change.type === 'law.propose') {
      expect(proposals[0].change.category).toBe('governance');
    }
    expect(proposals[0].confidence).toBe(0.6);
  });

  it('should return [] when active_laws >= 3', () => {
    const chief = makeChief({ role: 'event coordinator' });
    const laws = Array.from({ length: 3 }, (_, i) => ({
      id: `law-${i}`, village_id: 'v-test', proposed_by: 'chief-test',
      approved_by: null, version: 1, status: 'active' as const,
      category: 'governance', content: { description: 'test', strategy: {} },
      risk_level: 'low' as const,
      evidence: { source: 'test', reasoning: 'test' },
      effectiveness: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }));
    const state = makeMinimalState({ active_laws: laws });

    const proposals = eventStrategy(chief, state);
    expect(proposals).toHaveLength(0);
  });

  it('should propose operational when governance law already exists', () => {
    const chief = makeChief({ role: 'event coordinator' });
    const state = makeMinimalState({
      active_laws: [{
        id: 'law-1', village_id: 'v-test', proposed_by: 'chief-test',
        approved_by: null, version: 1, status: 'active' as const,
        category: 'governance', content: { description: 'test', strategy: {} },
        risk_level: 'low' as const,
        evidence: { source: 'test', reasoning: 'test' },
        effectiveness: null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }],
    });

    const proposals = eventStrategy(chief, state);
    expect(proposals).toHaveLength(1);
    if (proposals[0].change.type === 'law.propose') {
      expect(proposals[0].change.category).toBe('operational');
    }
  });
});

describe('safetyStrategy', () => {
  it('should detect permission violations', () => {
    const chief = makeChief({ role: 'safety officer' });
    const state = makeMinimalState({
      chiefs: [{
        ...makeChief({ id: 'chief-rogue', name: 'RogueChief' }),
        permissions: ['dispatch_task', 'deploy' as 'dispatch_task'], // deploy 不在 allowed
      }],
    });

    const proposals = safetyStrategy(chief, state);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].change.type).toBe('chief.update_permissions');
    if (proposals[0].change.type === 'chief.update_permissions') {
      expect(proposals[0].change.permissions).toEqual(['dispatch_task']);
    }
    expect(proposals[0].confidence).toBe(0.9);
  });

  it('should return [] when all permissions valid', () => {
    const chief = makeChief({ role: 'safety officer' });
    const state = makeMinimalState({
      chiefs: [makeChief({ id: 'chief-good', name: 'GoodChief' })],
    });

    const proposals = safetyStrategy(chief, state);
    expect(proposals).toHaveLength(0);
  });

  it('should return [] when no constitution', () => {
    const chief = makeChief({ role: 'safety officer' });
    const state = makeMinimalState({ constitution: null });
    const proposals = safetyStrategy(chief, state);
    expect(proposals).toHaveLength(0);
  });
});

describe('loreStrategy', () => {
  it('should flag missing village description', () => {
    const chief = makeChief({ role: 'lore keeper' });
    const state = makeMinimalState();
    state.village.description = '';

    const proposals = loreStrategy(chief, state);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].change.type).toBe('village.update');
    expect(proposals[0].confidence).toBe(0.4);
    expect(proposals[0].trigger).toContain('village_missing_description');
  });

  it('should return [] when no inconsistencies', () => {
    const chief = makeChief({ role: 'lore keeper' });
    const state = makeMinimalState({
      chiefs: [makeChief({ constraints: [{ type: 'must', description: 'be good' }] })],
    });

    const proposals = loreStrategy(chief, state);
    expect(proposals).toHaveLength(0);
  });
});

describe('growthStrategy', () => {
  it('should detect harmful active laws', () => {
    const chief = makeChief({ role: 'growth analyst' });
    const state = makeMinimalState({
      active_laws: [{
        id: 'law-bad', village_id: 'v-test', proposed_by: 'chief-test',
        approved_by: null, version: 1, status: 'active' as const,
        category: 'operational', content: { description: 'bad law', strategy: {} },
        risk_level: 'low' as const,
        evidence: { source: 'test', reasoning: 'test' },
        effectiveness: { measured_at: new Date().toISOString(), metrics: { quality: -1 }, verdict: 'harmful' },
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }],
      chiefs: [makeChief()],
    });

    const proposals = growthStrategy(chief, state);
    // Should have harmful law proposal + skill gap proposal
    const harmfulProposal = proposals.find(p =>
      p.change.type === 'law.propose' &&
      p.change.category === 'improvement',
    );
    expect(harmfulProposal).toBeDefined();
    expect(harmfulProposal?.confidence).toBe(0.5);
  });

  it('should detect skill gaps', () => {
    const chief = makeChief({ role: 'growth analyst' });
    const state = makeMinimalState({
      chiefs: [makeChief(), makeChief({ id: 'chief-2', name: 'Chief2' })],
      skills: [], // 0 skills for 2 chiefs
    });

    const proposals = growthStrategy(chief, state);
    const skillGapProposal = proposals.find(p =>
      p.change.type === 'law.propose' &&
      p.change.category === 'capability',
    );
    expect(skillGapProposal).toBeDefined();
  });

  it('should return [] when no issues', () => {
    const chief = makeChief({ role: 'growth analyst' });
    const state = makeMinimalState(); // no chiefs, no harmful laws

    const proposals = growthStrategy(chief, state);
    expect(proposals).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// B. Role Resolution Tests
// ---------------------------------------------------------------------------

describe('resolveStrategy', () => {
  it('should map "economy advisor" to economyStrategy', () => {
    const chief = makeChief({ role: 'economy advisor' });
    expect(resolveStrategy(chief)).toBe(economyStrategy);
  });

  it('should map "safety officer" to safetyStrategy', () => {
    const chief = makeChief({ role: 'safety officer' });
    expect(resolveStrategy(chief)).toBe(safetyStrategy);
  });

  it('should map "budget manager" to economyStrategy', () => {
    const chief = makeChief({ role: 'budget manager' });
    expect(resolveStrategy(chief)).toBe(economyStrategy);
  });

  it('should map "event coordinator" to eventStrategy', () => {
    const chief = makeChief({ role: 'event coordinator' });
    expect(resolveStrategy(chief)).toBe(eventStrategy);
  });

  it('should map "growth analyst" to growthStrategy', () => {
    const chief = makeChief({ role: 'growth analyst' });
    expect(resolveStrategy(chief)).toBe(growthStrategy);
  });

  it('should return null for unknown roles', () => {
    const chief = makeChief({ role: 'general manager' });
    expect(resolveStrategy(chief)).toBeNull();
  });

  it('should be case-insensitive', () => {
    const chief = makeChief({ role: 'ECONOMY Advisor' });
    expect(resolveStrategy(chief)).toBe(economyStrategy);
  });
});

// ---------------------------------------------------------------------------
// C. Personality Filter Tests
// ---------------------------------------------------------------------------

describe('shouldPropose', () => {
  it('should filter low-confidence for conservative chief', () => {
    const chief = makeChief({
      personality: { risk_tolerance: 'conservative', communication_style: 'concise', decision_speed: 'cautious' },
    });
    const lowConfidence: ChiefProposal = {
      change: { type: 'village.update', name: 'test' },
      reason: 'test',
      confidence: 0.5,
      trigger: 'test',
    };
    expect(shouldPropose(lowConfidence, chief)).toBe(false);
  });

  it('should accept high-confidence for conservative chief', () => {
    const chief = makeChief({
      personality: { risk_tolerance: 'conservative', communication_style: 'concise', decision_speed: 'cautious' },
    });
    const highConfidence: ChiefProposal = {
      change: { type: 'village.update', name: 'test' },
      reason: 'test',
      confidence: 0.7,
      trigger: 'test',
    };
    expect(shouldPropose(highConfidence, chief)).toBe(true);
  });

  it('should accept low-confidence for aggressive chief', () => {
    const chief = makeChief({
      personality: { risk_tolerance: 'aggressive', communication_style: 'concise', decision_speed: 'fast' },
    });
    const lowConfidence: ChiefProposal = {
      change: { type: 'village.update', name: 'test' },
      reason: 'test',
      confidence: 0.3,
      trigger: 'test',
    };
    expect(shouldPropose(lowConfidence, chief)).toBe(true);
  });

  it('should use 0.5 threshold for moderate chief', () => {
    const chief = makeChief({
      personality: { risk_tolerance: 'moderate', communication_style: 'concise', decision_speed: 'deliberate' },
    });

    expect(shouldPropose(
      { change: { type: 'village.update' }, reason: 'test', confidence: 0.5, trigger: 'test' },
      chief,
    )).toBe(true);

    expect(shouldPropose(
      { change: { type: 'village.update' }, reason: 'test', confidence: 0.4, trigger: 'test' },
      chief,
    )).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// D. Integration Tests (with in-memory SQLite via WorldManager)
// ---------------------------------------------------------------------------

describe('makeChiefDecision (integration)', () => {
  it('should return proposals for economy chief with running cycles', () => {
    const chief = makeChief({ role: 'economy advisor' });
    const state = makeMinimalState({
      running_cycles: [{
        id: 'cycle-1', village_id: 'v-test', chief_id: 'chief-test',
        trigger: 'manual' as const, status: 'running' as const, version: 1,
        budget_remaining: 50, cost_incurred: 0, iterations: 0,
        max_iterations: 10, timeout_ms: 30000, actions: [], laws_proposed: [],
        laws_enacted: [], abort_reason: null, intent: null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }],
    });

    const proposals = makeChiefDecision(chief, state);
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals[0].change.type).toBe('budget.adjust');
  });
});

describe('executeChiefCycle (integration)', () => {
  let vm: VillageManager;
  let cs: ConstitutionStore;
  let ce: ChiefEngine;
  let wm: WorldManager;

  beforeEach(() => {
    const s = setup();
    vm = s.vm;
    cs = s.cs;
    ce = s.ce;
    wm = s.wm;
  });

  it('should apply valid proposal through judge pipeline', () => {
    const village = createVillage(vm);
    createConstitution(cs, village.id);
    const chief = createChief(ce, village.id, { role: 'event coordinator' });

    // No laws → event strategy should propose one
    const result = executeChiefCycle(wm, village.id, chief);
    expect(result.chief_id).toBe(chief.id);
    expect(result.proposals.length).toBeGreaterThan(0);
    // At least one should be applied (law.propose with valid chief)
    expect(result.applied.length).toBeGreaterThanOrEqual(1);
    expect(result.applied[0].applied).toBe(true);
  });

  it('should skip proposal rejected by judge', () => {
    const village = createVillage(vm);
    // No constitution → law.propose will be rejected by judge (SI-1)
    const chief = makeChief({
      id: 'chief-fake',
      village_id: village.id,
      role: 'event coordinator',
    });

    const result = executeChiefCycle(wm, village.id, chief);
    // Event strategy triggers (< 3 laws), but judge rejects (no constitution)
    if (result.proposals.length > 0) {
      expect(result.skipped.length).toBeGreaterThan(0);
      expect(result.applied).toHaveLength(0);
    }
  });

  it('should return empty result for inactive chief', () => {
    const village = createVillage(vm);
    createConstitution(cs, village.id);
    const chief = createChief(ce, village.id, { role: 'event coordinator' });
    ce.deactivate(chief.id, 'test-actor');

    const inactiveChief = ce.get(chief.id);
    if (!inactiveChief) throw new Error('Chief not found');

    const result = executeChiefCycle(wm, village.id, inactiveChief);
    expect(result.proposals).toHaveLength(0);
    expect(result.applied).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });

  it('should return empty proposals for unknown role', () => {
    const village = createVillage(vm);
    createConstitution(cs, village.id);
    const chief = createChief(ce, village.id, { role: 'general manager' });

    const result = executeChiefCycle(wm, village.id, chief);
    expect(result.proposals).toHaveLength(0);
    expect(result.applied).toHaveLength(0);
  });

});

// ---------------------------------------------------------------------------
// E. Edge Cases
// ---------------------------------------------------------------------------

describe('Edge cases', () => {
  it('should handle WorldState with no constitution gracefully', () => {
    const chief = makeChief({ role: 'economy advisor' });
    const state = makeMinimalState({ constitution: null });
    const proposals = makeChiefDecision(chief, state);
    expect(proposals).toHaveLength(0);
  });

  it('should filter some proposals while keeping others based on personality', () => {
    // Conservative chief (threshold 0.7) + lore strategy (confidence 0.4) → filtered
    const chief = makeChief({
      role: 'lore keeper',
      personality: { risk_tolerance: 'conservative', communication_style: 'detailed', decision_speed: 'cautious' },
    });
    const state = makeMinimalState();
    state.village.description = ''; // trigger lore flag

    const proposals = makeChiefDecision(chief, state);
    // Lore confidence is 0.4, conservative threshold is 0.7 → filtered out
    expect(proposals).toHaveLength(0);
  });

  it('should pass lore proposals for aggressive chief', () => {
    // Aggressive chief (threshold 0.3) + lore strategy (confidence 0.4) → passes
    const chief = makeChief({
      role: 'lore keeper',
      personality: { risk_tolerance: 'aggressive', communication_style: 'concise', decision_speed: 'fast' },
    });
    const state = makeMinimalState();
    state.village.description = ''; // trigger lore flag

    const proposals = makeChiefDecision(chief, state);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].change.type).toBe('village.update');
  });

  it('should handle multiple proposals from single strategy', () => {
    // Growth strategy can produce both harmful-law and skill-gap proposals
    const chief = makeChief({
      role: 'growth analyst',
      personality: { risk_tolerance: 'moderate', communication_style: 'concise', decision_speed: 'deliberate' },
    });
    const state = makeMinimalState({
      chiefs: [makeChief(), makeChief({ id: 'chief-2', name: 'Chief2' })],
      skills: [],
      active_laws: [{
        id: 'law-bad', village_id: 'v-test', proposed_by: 'chief-test',
        approved_by: null, version: 1, status: 'active' as const,
        category: 'operational', content: { description: 'bad', strategy: {} },
        risk_level: 'low' as const,
        evidence: { source: 'test', reasoning: 'test' },
        effectiveness: { measured_at: new Date().toISOString(), metrics: {}, verdict: 'harmful' },
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }],
    });

    const proposals = makeChiefDecision(chief, state);
    // Both should pass moderate threshold (0.5 >= 0.5)
    expect(proposals).toHaveLength(2);
  });
});
