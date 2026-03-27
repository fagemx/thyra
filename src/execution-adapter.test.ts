import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { initSchema } from './db';
import { WorldManager } from './world-manager';
import { VillageManager } from './village-manager';
import { ConstitutionStore } from './constitution-store';
import { ChiefEngine } from './chief-engine';
import { SkillRegistry } from './skill-registry';
import type { HeartbeatContext, HeartbeatResult } from './schemas/heartbeat';
import {
  ExecutionAdapterRegistry,
  LocalAdapter,
  KarviPipelineAdapter,
  buildHeartbeatContext,
  processHeartbeatResult,
  createDefaultRegistry,
  type ExecutionAdapter,
} from './execution-adapter';
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

function createVillageWithConstitution(
  vm: VillageManager,
  cs: ConstitutionStore,
  name = 'Test Village',
) {
  const village = vm.create({
    name,
    target_repo: 'test/repo',
  }, 'test-actor');
  cs.create(village.id, {
    rules: [{ id: 'r1', description: 'test rule', enforcement: 'hard' as const }],
    allowed_permissions: ['dispatch_task', 'enact_law_low'],
    budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
  }, 'test-actor');
  return village;
}

function createActiveChief(
  ce: ChiefEngine,
  villageId: string,
  role: string,
  name?: string,
) {
  return ce.create(villageId, {
    name: name ?? `Chief-${role}`,
    role,
    permissions: ['dispatch_task'],
    skills: [],
  }, 'test-actor');
}

// ---------------------------------------------------------------------------
// ExecutionAdapterRegistry tests
// ---------------------------------------------------------------------------

describe('ExecutionAdapterRegistry', () => {
  it('register and get adapter', () => {
    const registry = new ExecutionAdapterRegistry();
    const mockAdapter: ExecutionAdapter = {
      type: 'test',
      invoke: async (_ctx: HeartbeatContext) => ({
        heartbeat_id: _ctx.heartbeat_id,
        status: 'completed' as const,
      }),
    };
    registry.register(mockAdapter);
    expect(registry.get('test')).toBe(mockAdapter);
  });

  it('throws on unknown adapter type', () => {
    const registry = new ExecutionAdapterRegistry();
    expect(() => registry.get('nonexistent')).toThrow('ADAPTER_NOT_FOUND');
  });

  it('has() returns correct boolean', () => {
    const registry = new ExecutionAdapterRegistry();
    expect(registry.has('local')).toBe(false);
    const mockAdapter: ExecutionAdapter = {
      type: 'local',
      invoke: async (ctx: HeartbeatContext) => ({
        heartbeat_id: ctx.heartbeat_id,
        status: 'completed' as const,
      }),
    };
    registry.register(mockAdapter);
    expect(registry.has('local')).toBe(true);
  });

  it('listTypes() returns all registered types', () => {
    const registry = new ExecutionAdapterRegistry();
    const a1: ExecutionAdapter = {
      type: 'alpha',
      invoke: async (ctx: HeartbeatContext) => ({ heartbeat_id: ctx.heartbeat_id, status: 'completed' as const }),
    };
    const a2: ExecutionAdapter = {
      type: 'beta',
      invoke: async (ctx: HeartbeatContext) => ({ heartbeat_id: ctx.heartbeat_id, status: 'completed' as const }),
    };
    registry.register(a1);
    registry.register(a2);
    expect(registry.listTypes().sort()).toEqual(['alpha', 'beta']);
  });

  it('register overwrites existing adapter of same type', () => {
    const registry = new ExecutionAdapterRegistry();
    const a1: ExecutionAdapter = {
      type: 'local',
      invoke: async (ctx: HeartbeatContext) => ({ heartbeat_id: ctx.heartbeat_id, status: 'completed' as const }),
    };
    const a2: ExecutionAdapter = {
      type: 'local',
      invoke: async (ctx: HeartbeatContext) => ({ heartbeat_id: ctx.heartbeat_id, status: 'failed' as const }),
    };
    registry.register(a1);
    registry.register(a2);
    expect(registry.get('local')).toBe(a2);
  });
});

// ---------------------------------------------------------------------------
// LocalAdapter tests
// ---------------------------------------------------------------------------

describe('LocalAdapter', () => {
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

  it('has type "local"', () => {
    const adapter = new LocalAdapter(wm, (id) => ce.get(id));
    expect(adapter.type).toBe('local');
  });

  it('invoke produces completed result for event chief', async () => {
    const village = createVillageWithConstitution(vm, cs);
    const chief = createActiveChief(ce, village.id, 'event coordinator');

    const adapter = new LocalAdapter(wm, (id) => ce.get(id));
    const context = buildHeartbeatContext(chief, wm.getState(village.id), 'scheduled');
    const result = await adapter.invoke(context);

    expect(result.heartbeat_id).toBe(context.heartbeat_id);
    expect(result.status).toBe('completed');
    expect(result.usage).toBeDefined();
    expect(result.usage?.duration_ms).toBeGreaterThanOrEqual(0);
    // Event strategy should produce proposals when laws < 3
    expect(result.proposals).toBeDefined();
    expect(result.proposals?.length).toBeGreaterThan(0);
  });

  it('invoke returns failed for unknown chief', async () => {
    const adapter = new LocalAdapter(wm, () => null);
    const context: HeartbeatContext = {
      heartbeat_id: 'hb-test',
      village_id: 'v1',
      chief_id: 'nonexistent',
      trigger: 'scheduled',
      context_mode: 'fat',
      budget_remaining: 100,
      permissions: [],
      constitution_rules: [],
      assigned_tasks: [],
    };
    const result = await adapter.invoke(context);
    expect(result.status).toBe('failed');
  });

  it('invoke returns no proposals for unknown role', async () => {
    const village = createVillageWithConstitution(vm, cs);
    const chief = createActiveChief(ce, village.id, 'unknown role', 'UnknownChief');

    const adapter = new LocalAdapter(wm, (id) => ce.get(id));
    const context = buildHeartbeatContext(chief, wm.getState(village.id), 'scheduled');
    const result = await adapter.invoke(context);

    expect(result.status).toBe('completed');
    expect(result.proposals).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// KarviPipelineAdapter tests
// ---------------------------------------------------------------------------

describe('KarviPipelineAdapter', () => {
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

  function makeMockBridge(dispatches: unknown[]): KarviBridge {
    return {
      dispatchProject: async (input: unknown) => {
        dispatches.push(input);
        return { ok: true, title: 'test', taskCount: 1 } as KarviProjectResponse;
      },
    } as unknown as KarviBridge;
  }

  it('has type "karvi"', () => {
    const adapter = new KarviPipelineAdapter(
      makeMockBridge([]),
      (id) => ce.get(id),
    );
    expect(adapter.type).toBe('karvi');
  });

  it('invoke dispatches pipeline via bridge and returns in_progress', async () => {
    const village = createVillageWithConstitution(vm, cs);
    const chief = ce.create(village.id, {
      name: 'PipelineChief',
      role: 'economy advisor',
      permissions: ['dispatch_task'],
      skills: [],
      pipelines: ['market-analysis'],
      adapter_type: 'karvi',
    }, 'test-actor');

    const dispatches: unknown[] = [];
    const adapter = new KarviPipelineAdapter(
      makeMockBridge(dispatches),
      (id) => ce.get(id),
    );

    const context = buildHeartbeatContext(chief, wm.getState(village.id), 'scheduled');
    const result = await adapter.invoke(context);

    expect(result.heartbeat_id).toBe(context.heartbeat_id);
    expect(result.status).toBe('in_progress');
    expect(result.usage?.duration_ms).toBeGreaterThanOrEqual(0);
    expect(dispatches).toHaveLength(1);
  });

  it('invoke returns failed for unknown chief', async () => {
    const adapter = new KarviPipelineAdapter(
      makeMockBridge([]),
      () => null,
    );

    const context: HeartbeatContext = {
      heartbeat_id: 'hb-test',
      village_id: 'v1',
      chief_id: 'nonexistent',
      trigger: 'scheduled',
      context_mode: 'fat',
      budget_remaining: 100,
      permissions: [],
      constitution_rules: [],
      assigned_tasks: [],
    };
    const result = await adapter.invoke(context);
    expect(result.status).toBe('failed');
  });

  it('invoke returns failed on bridge error', async () => {
    const village = createVillageWithConstitution(vm, cs);
    const chief = ce.create(village.id, {
      name: 'ErrorChief',
      role: 'economy advisor',
      permissions: ['dispatch_task'],
      skills: [],
      pipelines: ['broken-pipeline'],
      adapter_type: 'karvi',
    }, 'test-actor');

    const errorBridge = {
      dispatchProject: async () => {
        throw new Error('Karvi unreachable');
      },
    } as unknown as KarviBridge;

    const adapter = new KarviPipelineAdapter(
      errorBridge,
      (id) => ce.get(id),
    );

    const context = buildHeartbeatContext(chief, wm.getState(village.id), 'scheduled');
    const result = await adapter.invoke(context);

    expect(result.status).toBe('failed');
    expect(result.usage?.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('invoke returns failed when bridge returns null (Karvi offline)', async () => {
    const village = createVillageWithConstitution(vm, cs);
    const chief = ce.create(village.id, {
      name: 'OfflineChief',
      role: 'economy advisor',
      permissions: ['dispatch_task'],
      skills: [],
      pipelines: ['offline-pipeline'],
      adapter_type: 'karvi',
    }, 'test-actor');

    const offlineBridge = {
      dispatchProject: async () => null,
    } as unknown as KarviBridge;

    const adapter = new KarviPipelineAdapter(
      offlineBridge,
      (id) => ce.get(id),
    );

    const context = buildHeartbeatContext(chief, wm.getState(village.id), 'scheduled');
    const result = await adapter.invoke(context);

    // dispatchChiefPipelines returns dispatched=false when response is null
    expect(result.status).toBe('failed');
  });

  it('healthCheck returns true (Phase 1 stub)', async () => {
    const adapter = new KarviPipelineAdapter(
      makeMockBridge([]),
      () => null,
    );
    expect(await adapter.healthCheck()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildHeartbeatContext tests
// ---------------------------------------------------------------------------

describe('buildHeartbeatContext', () => {
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

  it('fat mode includes world_state_summary', () => {
    const village = createVillageWithConstitution(vm, cs);
    const chief = createActiveChief(ce, village.id, 'event coordinator');
    const state = wm.getState(village.id);

    const context = buildHeartbeatContext(chief, state, 'scheduled');

    expect(context.context_mode).toBe('fat');
    expect(context.world_state_summary).toBeDefined();
    expect(context.world_state_summary?.village_name).toBe(village.name);
    expect(context.world_state_summary?.chiefs_count).toBe(1);
  });

  it('thin mode omits world_state_summary', () => {
    const village = createVillageWithConstitution(vm, cs);
    const chief = ce.create(village.id, {
      name: 'ThinChief',
      role: 'event coordinator',
      permissions: ['dispatch_task'],
      skills: [],
      context_mode: 'thin',
    }, 'test-actor');
    const state = wm.getState(village.id);

    const context = buildHeartbeatContext(chief, state, 'on_demand');

    expect(context.context_mode).toBe('thin');
    expect(context.world_state_summary).toBeUndefined();
    expect(context.goals).toBeUndefined();
    expect(context.precedents).toBeUndefined();
  });

  it('includes correct constraint fields', () => {
    const village = createVillageWithConstitution(vm, cs);
    const chief = createActiveChief(ce, village.id, 'event coordinator');
    const state = wm.getState(village.id);

    const context = buildHeartbeatContext(chief, state, 'scheduled');

    expect(context.village_id).toBe(village.id);
    expect(context.chief_id).toBe(chief.id);
    expect(context.trigger).toBe('scheduled');
    expect(context.budget_remaining).toBe(100); // max_cost_per_day
    expect(context.permissions).toContain('dispatch_task');
    expect(context.constitution_rules).toContain('test rule');
    expect(context.heartbeat_id).toMatch(/^hb-/);
  });

  it('fat mode includes goals and precedents when provided', () => {
    const village = createVillageWithConstitution(vm, cs);
    const chief = createActiveChief(ce, village.id, 'event coordinator');
    const state = wm.getState(village.id);

    const context = buildHeartbeatContext(chief, state, 'scheduled', {
      goals: [{ id: 'g1', description: 'grow' }],
      precedents: [{ id: 'p1', verdict: 'approved' }],
    });

    expect(context.goals).toHaveLength(1);
    expect(context.precedents).toHaveLength(1);
  });

  it('assigns correct trigger value', () => {
    const village = createVillageWithConstitution(vm, cs);
    const chief = createActiveChief(ce, village.id, 'event coordinator');
    const state = wm.getState(village.id);

    for (const trigger of ['scheduled', 'assignment', 'on_demand', 'event'] as const) {
      const context = buildHeartbeatContext(chief, state, trigger);
      expect(context.trigger).toBe(trigger);
    }
  });
});

// ---------------------------------------------------------------------------
// processHeartbeatResult tests
// ---------------------------------------------------------------------------

describe('processHeartbeatResult', () => {
  let db: Database;
  let vm: VillageManager;
  let cs: ConstitutionStore;
  let ce: ChiefEngine;
  let wm: WorldManager;

  beforeEach(() => {
    const s = setup();
    db = s.db;
    vm = s.vm;
    cs = s.cs;
    ce = s.ce;
    wm = s.wm;
  });

  it('processes completed result with proposals through judge pipeline', () => {
    const village = createVillageWithConstitution(vm, cs);
    const chief = createActiveChief(ce, village.id, 'event coordinator');

    const result: HeartbeatResult = {
      heartbeat_id: 'hb-test-001',
      status: 'completed',
      proposals: [{
        type: 'budget.adjust',
        max_cost_per_action: 8,
      }],
      usage: { duration_ms: 100 },
    };

    const processed = processHeartbeatResult(wm, db, village.id, chief, result);

    expect(processed.heartbeat_id).toBe('hb-test-001');
    expect(processed.status).toBe('completed');
    expect(processed.proposals_count).toBe(1);
    expect(processed.applied.length + processed.rejected_count).toBe(1);
  });

  it('writes usage to audit_log', () => {
    const village = createVillageWithConstitution(vm, cs);
    const chief = createActiveChief(ce, village.id, 'event coordinator');

    const result: HeartbeatResult = {
      heartbeat_id: 'hb-test-002',
      status: 'completed',
      usage: {
        input_tokens: 500,
        output_tokens: 200,
        cost_cents: 1.5,
        duration_ms: 2000,
      },
    };

    processHeartbeatResult(wm, db, village.id, chief, result);

    // Check audit_log for usage entry
    const usageRow = db.prepare(
      "SELECT * FROM audit_log WHERE entity_type = 'heartbeat' AND entity_id = ? AND action = 'usage'"
    ).get('hb-test-002') as Record<string, unknown> | null;

    expect(usageRow).not.toBeNull();
    const payload = JSON.parse(usageRow?.payload as string) as Record<string, unknown>;
    expect(payload.input_tokens).toBe(500);
    expect(payload.cost_cents).toBe(1.5);
    expect(payload.chief_id).toBe(chief.id);
  });

  it('writes result record to audit_log', () => {
    const village = createVillageWithConstitution(vm, cs);
    const chief = createActiveChief(ce, village.id, 'event coordinator');

    const result: HeartbeatResult = {
      heartbeat_id: 'hb-test-003',
      status: 'completed',
    };

    processHeartbeatResult(wm, db, village.id, chief, result);

    const resultRow = db.prepare(
      "SELECT * FROM audit_log WHERE entity_type = 'heartbeat' AND entity_id = ? AND action = 'result'"
    ).get('hb-test-003') as Record<string, unknown> | null;

    expect(resultRow).not.toBeNull();
    const payload = JSON.parse(resultRow?.payload as string) as Record<string, unknown>;
    expect(payload.status).toBe('completed');
  });

  it('handles failed status gracefully', () => {
    const village = createVillageWithConstitution(vm, cs);
    const chief = createActiveChief(ce, village.id, 'event coordinator');

    const result: HeartbeatResult = {
      heartbeat_id: 'hb-test-004',
      status: 'failed',
    };

    const processed = processHeartbeatResult(wm, db, village.id, chief, result);

    expect(processed.status).toBe('failed');
    expect(processed.proposals_count).toBe(0);
    expect(processed.applied).toHaveLength(0);
    expect(processed.rejected_count).toBe(0);
  });

  it('handles result with no proposals', () => {
    const village = createVillageWithConstitution(vm, cs);
    const chief = createActiveChief(ce, village.id, 'event coordinator');

    const result: HeartbeatResult = {
      heartbeat_id: 'hb-test-005',
      status: 'completed',
    };

    const processed = processHeartbeatResult(wm, db, village.id, chief, result);

    expect(processed.proposals_count).toBe(0);
    expect(processed.applied).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// createDefaultRegistry tests
// ---------------------------------------------------------------------------

describe('createDefaultRegistry', () => {
  it('creates registry with local adapter (no bridge)', () => {
    const s = setup();
    const registry = createDefaultRegistry(s.wm, (id) => s.ce.get(id));

    expect(registry.has('local')).toBe(true);
    expect(registry.get('local').type).toBe('local');
    expect(registry.has('karvi')).toBe(false);
  });

  it('creates registry with local + karvi adapters when bridge provided', () => {
    const s = setup();
    const mockBridge = {
      dispatchProject: async () => null,
    } as unknown as KarviBridge;

    const registry = createDefaultRegistry(s.wm, (id) => s.ce.get(id), mockBridge);

    expect(registry.has('local')).toBe(true);
    expect(registry.has('karvi')).toBe(true);
    expect(registry.get('karvi').type).toBe('karvi');
  });
});

// ---------------------------------------------------------------------------
// Chief schema extension tests
// ---------------------------------------------------------------------------

describe('Chief with heartbeat fields', () => {
  let vm: VillageManager;
  let cs: ConstitutionStore;
  let ce: ChiefEngine;

  beforeEach(() => {
    const s = setup();
    vm = s.vm;
    cs = s.cs;
    ce = s.ce;
  });

  it('create chief defaults to adapter_type=local, context_mode=fat', () => {
    const village = createVillageWithConstitution(vm, cs);
    const chief = createActiveChief(ce, village.id, 'event coordinator');

    expect(chief.adapter_type).toBe('local');
    expect(chief.context_mode).toBe('fat');
    expect(chief.adapter_config).toEqual({});
  });

  it('create chief with custom adapter_type and context_mode', () => {
    const village = createVillageWithConstitution(vm, cs);
    const chief = ce.create(village.id, {
      name: 'HTTP Chief',
      role: 'event coordinator',
      permissions: ['dispatch_task'],
      skills: [],
      adapter_type: 'http',
      context_mode: 'thin',
      adapter_config: { url: 'https://agent.example.com/heartbeat' },
    }, 'test-actor');

    expect(chief.adapter_type).toBe('http');
    expect(chief.context_mode).toBe('thin');
    expect(chief.adapter_config).toEqual({ url: 'https://agent.example.com/heartbeat' });
  });

  it('update chief adapter_type and context_mode', () => {
    const village = createVillageWithConstitution(vm, cs);
    const chief = createActiveChief(ce, village.id, 'event coordinator');

    const updated = ce.update(chief.id, {
      adapter_type: 'karvi',
      context_mode: 'thin',
      adapter_config: { pipeline: 'main' },
    }, 'test-actor');

    expect(updated.adapter_type).toBe('karvi');
    expect(updated.context_mode).toBe('thin');
    expect(updated.adapter_config).toEqual({ pipeline: 'main' });
  });

  it('get chief preserves heartbeat fields from DB', () => {
    const village = createVillageWithConstitution(vm, cs);
    const chief = ce.create(village.id, {
      name: 'Persistent Chief',
      role: 'safety monitor',
      permissions: ['dispatch_task'],
      skills: [],
      adapter_type: 'http',
      context_mode: 'thin',
      adapter_config: { url: 'https://example.com' },
    }, 'test-actor');

    const loaded = ce.get(chief.id);
    expect(loaded).not.toBeNull();
    expect(loaded?.adapter_type).toBe('http');
    expect(loaded?.context_mode).toBe('thin');
    expect(loaded?.adapter_config).toEqual({ url: 'https://example.com' });
  });
});
