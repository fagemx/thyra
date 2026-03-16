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
  resolveChiefPriority,
  sortChiefsByPriority,
  shouldPropose,
  makeChiefDecision,
  executeChiefCycle,
  executeChiefCycleWithState,
  executeCoordinatedCycle,
  dispatchChiefPipelines,
  DEFAULT_PRIORITY,
  type ChiefProposal,
} from './chief-autonomy';
import type { KarviBridge, KarviProjectResponse } from './karvi-bridge';

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
      budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50, max_cost_per_month: 0 },
      superseded_by: null,
    },
    chiefs: [],
    active_laws: [],
    skills: [],
    running_cycles: [],
    goals: [],
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
    budget_config: null,
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

// ---------------------------------------------------------------------------
// F. Pipeline Dispatch Tests (#212)
// ---------------------------------------------------------------------------

describe('dispatchChiefPipelines', () => {
  function makeMockKarviBridge(
    response: KarviProjectResponse | null = { ok: true, title: 'test', taskCount: 1 },
    shouldThrow = false,
  ): KarviBridge {
    return {
      dispatchProject: async () => {
        if (shouldThrow) throw new Error('Karvi dispatch failed: 500');
        return response;
      },
    } as unknown as KarviBridge;
  }

  it('should dispatch each pipeline as a Karvi project', async () => {
    const calls: unknown[] = [];
    const bridge = {
      dispatchProject: async (input: unknown) => {
        calls.push(input);
        return { ok: true, title: 'test', taskCount: 1 } as KarviProjectResponse;
      },
    } as unknown as KarviBridge;

    const chief = makeChief({
      id: 'chief-1',
      name: 'PipelineChief',
      pipelines: ['analyze-market', 'optimize-stalls'],
    });

    const results = await dispatchChiefPipelines(bridge, 'village-1', chief);

    expect(results).toHaveLength(2);
    expect(results[0].dispatched).toBe(true);
    expect(results[0].pipeline_id).toBe('analyze-market');
    expect(results[1].dispatched).toBe(true);
    expect(results[1].pipeline_id).toBe('optimize-stalls');
    expect(calls).toHaveLength(2);
  });

  it('should return dispatched=false when Karvi is offline', async () => {
    const bridge = makeMockKarviBridge(null);
    const chief = makeChief({ pipelines: ['some-pipeline'] });

    const results = await dispatchChiefPipelines(bridge, 'village-1', chief);

    expect(results).toHaveLength(1);
    expect(results[0].dispatched).toBe(false);
    expect(results[0].error).toBe('Karvi unreachable');
    expect(results[0].project_response).toBeNull();
  });

  it('should handle Karvi dispatch error gracefully', async () => {
    const bridge = makeMockKarviBridge(null, true);
    const chief = makeChief({ pipelines: ['failing-pipeline'] });

    const results = await dispatchChiefPipelines(bridge, 'village-1', chief);

    expect(results).toHaveLength(1);
    expect(results[0].dispatched).toBe(false);
    expect(results[0].error).toBe('Karvi dispatch failed: 500');
  });

  it('should return empty array for chief with no pipelines', async () => {
    const bridge = makeMockKarviBridge();
    const chief = makeChief({ pipelines: [] });

    const results = await dispatchChiefPipelines(bridge, 'village-1', chief);

    expect(results).toHaveLength(0);
  });

  it('should include correct metadata in dispatch input', async () => {
    let capturedInput: Record<string, unknown> | null = null;
    const bridge = {
      dispatchProject: async (input: unknown) => {
        capturedInput = input as Record<string, unknown>;
        return { ok: true, title: 'test', taskCount: 1 } as KarviProjectResponse;
      },
    } as unknown as KarviBridge;

    const chief = makeChief({
      id: 'chief-xyz',
      name: 'MarketChief',
      pipelines: ['market-analysis'],
    });

    await dispatchChiefPipelines(bridge, 'village-abc', chief);

    expect(capturedInput).not.toBeNull();
    expect(capturedInput!.title).toBe('MarketChief:pipeline:market-analysis');
    expect(capturedInput!.autoStart).toBe(true);
    expect(capturedInput!.goal).toContain('MarketChief');
    const tasks = capturedInput!.tasks as Array<Record<string, unknown>>;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].skill).toBe('market-analysis');
    expect((tasks[0].id as string)).toContain('village-abc');
    expect((tasks[0].id as string)).toContain('chief-xyz');
  });
});

// ---------------------------------------------------------------------------
// G. Priority Ordering Tests (#200)
// ---------------------------------------------------------------------------

describe('resolveChiefPriority', () => {
  it('should return 1 for safety officer', () => {
    expect(resolveChiefPriority(makeChief({ role: 'safety officer' }))).toBe(1);
  });

  it('should return 2 for economy advisor', () => {
    expect(resolveChiefPriority(makeChief({ role: 'economy advisor' }))).toBe(2);
  });

  it('should return 3 for lore keeper', () => {
    expect(resolveChiefPriority(makeChief({ role: 'lore keeper' }))).toBe(3);
  });

  it('should return 4 for event coordinator', () => {
    expect(resolveChiefPriority(makeChief({ role: 'event coordinator' }))).toBe(4);
  });

  it('should return 5 for growth analyst', () => {
    expect(resolveChiefPriority(makeChief({ role: 'growth analyst' }))).toBe(5);
  });

  it('should return DEFAULT_PRIORITY for unknown role', () => {
    expect(resolveChiefPriority(makeChief({ role: 'general manager' }))).toBe(DEFAULT_PRIORITY);
  });

  it('should be case-insensitive', () => {
    expect(resolveChiefPriority(makeChief({ role: 'SAFETY Officer' }))).toBe(1);
  });
});

describe('sortChiefsByPriority', () => {
  it('should sort chiefs by priority order', () => {
    const growth = makeChief({ id: 'c-growth', role: 'growth analyst' });
    const safety = makeChief({ id: 'c-safety', role: 'safety officer' });
    const economy = makeChief({ id: 'c-economy', role: 'economy advisor' });

    const sorted = sortChiefsByPriority([growth, safety, economy]);
    expect(sorted.map(c => c.id)).toEqual(['c-safety', 'c-economy', 'c-growth']);
  });

  it('should use created_at as tiebreaker for same priority', () => {
    const older = makeChief({ id: 'c-old', role: 'safety officer', created_at: '2026-01-01T00:00:00Z' });
    const newer = makeChief({ id: 'c-new', role: 'security guard', created_at: '2026-02-01T00:00:00Z' });

    const sorted = sortChiefsByPriority([newer, older]);
    expect(sorted.map(c => c.id)).toEqual(['c-old', 'c-new']);
  });

  it('should return new array without mutating input', () => {
    const chiefs = [
      makeChief({ id: 'c-growth', role: 'growth analyst' }),
      makeChief({ id: 'c-safety', role: 'safety officer' }),
    ];
    const original = [...chiefs];
    const sorted = sortChiefsByPriority(chiefs);

    expect(sorted).not.toBe(chiefs);
    expect(chiefs.map(c => c.id)).toEqual(original.map(c => c.id));
  });

  it('should handle empty array', () => {
    expect(sortChiefsByPriority([])).toEqual([]);
  });

  it('should handle single chief', () => {
    const chief = makeChief({ id: 'c-solo', role: 'safety officer' });
    const sorted = sortChiefsByPriority([chief]);
    expect(sorted).toHaveLength(1);
    expect(sorted[0].id).toBe('c-solo');
  });
});

// ---------------------------------------------------------------------------
// H. Coordinated Cycle Tests (#200)
// ---------------------------------------------------------------------------

describe('executeChiefCycleWithState', () => {
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

  it('should use provided state instead of reading from DB', () => {
    const village = createVillage(vm);
    createConstitution(cs, village.id);
    const chief = createChief(ce, village.id, { role: 'event coordinator' });

    const state = wm.getState(village.id);
    const result = executeChiefCycleWithState(wm, village.id, chief, state);

    expect(result.chief_id).toBe(chief.id);
    expect(result.proposals.length).toBeGreaterThan(0);
  });

  it('should skip inactive chief', () => {
    const village = createVillage(vm);
    createConstitution(cs, village.id);
    const chief = createChief(ce, village.id, { role: 'event coordinator' });
    ce.deactivate(chief.id, 'test-actor');
    const inactiveChief = ce.get(chief.id);
    if (!inactiveChief) throw new Error('Chief not found');

    const state = wm.getState(village.id);
    const result = executeChiefCycleWithState(wm, village.id, inactiveChief, state);

    expect(result.proposals).toHaveLength(0);
    expect(result.applied).toHaveLength(0);
  });
});

describe('executeCoordinatedCycle', () => {
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

  it('should execute chiefs in priority order', () => {
    const village = createVillage(vm);
    createConstitution(cs, village.id);

    // Create chiefs in reverse priority order
    const growthChief = createChief(ce, village.id, { name: 'GrowthChief', role: 'growth analyst' });
    const eventChief = createChief(ce, village.id, { name: 'EventChief', role: 'event coordinator' });

    const result = executeCoordinatedCycle(wm, village.id, [growthChief, eventChief]);

    // Event (priority 4) before Growth (priority 5)
    expect(result.execution_order[0]).toBe(eventChief.id);
    expect(result.execution_order[1]).toBe(growthChief.id);
    expect(result.chief_results).toHaveLength(2);
  });

  it('should handle single chief as degenerate case', () => {
    const village = createVillage(vm);
    createConstitution(cs, village.id);
    const chief = createChief(ce, village.id, { role: 'event coordinator' });

    const result = executeCoordinatedCycle(wm, village.id, [chief]);

    expect(result.execution_order).toHaveLength(1);
    expect(result.chief_results).toHaveLength(1);
  });

  it('should handle empty chiefs array', () => {
    const village = createVillage(vm);
    createConstitution(cs, village.id);

    const result = executeCoordinatedCycle(wm, village.id, []);

    expect(result.execution_order).toHaveLength(0);
    expect(result.chief_results).toHaveLength(0);
    expect(result.state_transitions).toBe(0);
  });

  it('should skip inactive chiefs while preserving order for active ones', () => {
    const village = createVillage(vm);
    createConstitution(cs, village.id);

    const safetyChief = createChief(ce, village.id, { name: 'SafetyChief', role: 'safety officer' });
    const eventChief = createChief(ce, village.id, { name: 'EventChief', role: 'event coordinator' });
    ce.deactivate(safetyChief.id, 'test-actor');
    const inactiveSafety = ce.get(safetyChief.id);
    if (!inactiveSafety) throw new Error('Chief not found');

    const result = executeCoordinatedCycle(wm, village.id, [eventChief, inactiveSafety]);

    // Safety (priority 1) is first in order even though inactive
    expect(result.execution_order[0]).toBe(inactiveSafety.id);
    expect(result.execution_order[1]).toBe(eventChief.id);
    // Only event chief produces proposals
    const activeResults = result.chief_results.filter(r => r.proposals.length > 0);
    expect(activeResults).toHaveLength(1);
    expect(activeResults[0].chief_id).toBe(eventChief.id);
  });

  it('should track state_transitions count', () => {
    const village = createVillage(vm);
    createConstitution(cs, village.id);
    const chief = createChief(ce, village.id, { role: 'event coordinator' });

    const result = executeCoordinatedCycle(wm, village.id, [chief]);

    // Event strategy proposes a law when < 3 laws exist
    if (result.chief_results[0].applied.length > 0) {
      expect(result.state_transitions).toBeGreaterThan(0);
    }
  });
});
