import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { initSchema } from './db';
import { WorldManager } from './world-manager';
import { VillageManager } from './village-manager';
import { ConstitutionStore } from './constitution-store';
import { ChiefEngine } from './chief-engine';
import { SkillRegistry } from './skill-registry';
import { GovernanceScheduler, type GovernanceCycleResult } from './governance-scheduler';
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
// Tests
// ---------------------------------------------------------------------------

describe('GovernanceScheduler', () => {
  let db: Database;
  let vm: VillageManager;
  let cs: ConstitutionStore;
  let ce: ChiefEngine;
  let wm: WorldManager;
  let scheduler: GovernanceScheduler;

  beforeEach(() => {
    const s = setup();
    db = s.db;
    vm = s.vm;
    cs = s.cs;
    ce = s.ce;
    wm = s.wm;
    scheduler = new GovernanceScheduler({
      worldManager: wm,
      chiefEngine: ce,
      villageManager: vm,
      db,
      intervalMs: 60_000,
    });
  });

  afterEach(() => {
    scheduler.stop();
  });

  // -----------------------------------------------------------------------
  // 1. Basic contract: runOnce returns correct shape
  // -----------------------------------------------------------------------
  it('runOnce() returns GovernanceCycleResult with correct shape', async () => {
    const village = createVillageWithConstitution(vm, cs);
    createActiveChief(ce, village.id, 'event coordinator');

    const result = await scheduler.runOnce();

    expect(result.cycle_id).toMatch(/^cycle-/);
    expect(result.started_at).toBeTruthy();
    expect(result.finished_at).toBeTruthy();
    expect(typeof result.villages_processed).toBe('number');
    expect(typeof result.total_proposals).toBe('number');
    expect(typeof result.total_applied).toBe('number');
    expect(typeof result.total_rejected).toBe('number');
    expect(typeof result.total_skipped).toBe('number');
    expect(Array.isArray(result.chief_results)).toBe(true);
    expect(Array.isArray(result.errors)).toBe(true);
  });

  // -----------------------------------------------------------------------
  // 2. Executes all active chiefs sequentially
  // -----------------------------------------------------------------------
  it('runOnce() executes all active chiefs', async () => {
    const village = createVillageWithConstitution(vm, cs);
    createActiveChief(ce, village.id, 'event coordinator', 'EventChief');
    createActiveChief(ce, village.id, 'economy advisor', 'EconomyChief');

    const result = await scheduler.runOnce();

    // Both chiefs should have been executed
    expect(result.chief_results).toHaveLength(2);
    expect(result.villages_processed).toBe(1);
  });

  // -----------------------------------------------------------------------
  // 3. Skips inactive chiefs
  // -----------------------------------------------------------------------
  it('runOnce() skips inactive chiefs', async () => {
    const village = createVillageWithConstitution(vm, cs);
    const chief1 = createActiveChief(ce, village.id, 'event coordinator', 'ActiveChief');
    const chief2 = createActiveChief(ce, village.id, 'economy advisor', 'InactiveChief');
    ce.deactivate(chief2.id, 'test-actor');

    const result = await scheduler.runOnce();

    // Only 1 active chief should be processed (the active one)
    expect(result.chief_results).toHaveLength(1);
    expect(result.chief_results[0].chief_id).toBe(chief1.id);
  });

  // -----------------------------------------------------------------------
  // 4. Error isolation: one chief throws, others continue
  // -----------------------------------------------------------------------
  it('runOnce() isolates chief errors', async () => {
    const village = createVillageWithConstitution(vm, cs);
    createActiveChief(ce, village.id, 'event coordinator', 'GoodChief');

    // Create a second village whose WorldManager.getState will throw
    const village2 = vm.create({ name: 'Broken Village', target_repo: 'test/broken' }, 'test-actor');
    cs.create(village2.id, {
      rules: [{ id: 'r1', description: 'test', enforcement: 'hard' as const }],
      allowed_permissions: ['dispatch_task'],
      budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
    }, 'test-actor');
    createActiveChief(ce, village2.id, 'event coordinator', 'BrokenChief');

    // Override the WorldManager to throw on second village
    const origGetState = wm.getState.bind(wm);
    const patchedWm = Object.create(wm) as WorldManager;
    patchedWm.getState = (villageId: string) => {
      if (villageId === village2.id) {
        throw new Error('simulated village error');
      }
      return origGetState(villageId);
    };

    const errorScheduler = new GovernanceScheduler({
      worldManager: patchedWm,
      chiefEngine: ce,
      villageManager: vm,
      db,
    });

    const result = await errorScheduler.runOnce();

    // Should have processed both villages
    expect(result.villages_processed).toBe(2);
    // village1's chief succeeded, village2's chief errored
    expect(result.chief_results.length).toBeGreaterThanOrEqual(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].village_id).toBe(village2.id);
    expect(result.errors[0].error).toBe('simulated village error');
  });

  // -----------------------------------------------------------------------
  // 5. start/stop lifecycle
  // -----------------------------------------------------------------------
  it('start() and stop() manage timer lifecycle', () => {
    expect(scheduler.isRunning()).toBe(false);
    scheduler.start();
    expect(scheduler.isRunning()).toBe(true);
    scheduler.stop();
    expect(scheduler.isRunning()).toBe(false);
  });

  // -----------------------------------------------------------------------
  // 6. isRunning() returns correct state
  // -----------------------------------------------------------------------
  it('isRunning() reflects scheduler state', () => {
    expect(scheduler.isRunning()).toBe(false);
    scheduler.start();
    expect(scheduler.isRunning()).toBe(true);
    scheduler.stop();
    expect(scheduler.isRunning()).toBe(false);
  });

  // -----------------------------------------------------------------------
  // 7. Double-start guard
  // -----------------------------------------------------------------------
  it('start() throws if already running', () => {
    scheduler.start();
    expect(() => scheduler.start()).toThrow('GovernanceScheduler is already running');
  });

  // -----------------------------------------------------------------------
  // 8. Configurable intervalMs (CHIEF-02)
  // -----------------------------------------------------------------------
  it('accepts configurable intervalMs', () => {
    const customScheduler = new GovernanceScheduler({
      worldManager: wm,
      chiefEngine: ce,
      villageManager: vm,
      db,
      intervalMs: 10_000,
    });

    // Verify it constructs without error (interval is internal)
    expect(customScheduler.isRunning()).toBe(false);
    customScheduler.start();
    expect(customScheduler.isRunning()).toBe(true);
    customScheduler.stop();
  });

  // -----------------------------------------------------------------------
  // 9. Overlap guard (non-reentrant)
  // -----------------------------------------------------------------------
  it('runOnce() returns skipped when already cycling', async () => {
    const village = createVillageWithConstitution(vm, cs);
    createActiveChief(ce, village.id, 'event coordinator');

    // Test the guard by triggering a second runOnce during the first execution.
    // We patch VillageManager.list to call runOnce synchronously during iteration.
    let secondCallResult: GovernanceCycleResult | null = null;
    const origList = vm.list.bind(vm);
    const slowVm = Object.create(vm) as VillageManager;
    let firstCall = true;
    slowVm.list = (filters?: { status?: string }) => {
      const result = origList(filters);
      if (firstCall) {
        firstCall = false;
        // During the first runOnce, synchronously trigger a second runOnce.
        // At this point _cycling is true, so the second call should return skipped.
        // We can't await here (sync context), but since runOnce will return
        // synchronously (the overlap guard short-circuits), we capture the promise.
        const promise = directScheduler.runOnce();
        // Since the guard returns immediately (sync path), resolve should be available
        void promise.then(r => { secondCallResult = r; });
      }
      return result;
    };

    const directScheduler = new GovernanceScheduler({
      worldManager: wm,
      chiefEngine: ce,
      villageManager: slowVm,
      db,
    });

    const firstResult = await directScheduler.runOnce();
    // Allow microtask to resolve
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(firstResult.villages_processed).toBe(1);
    expect(secondCallResult).not.toBeNull();
    expect(secondCallResult!.skipped).toBe(true);
    expect(secondCallResult!.skip_reason).toBe('already_running');
  });

  // -----------------------------------------------------------------------
  // 10. onCycleComplete callback
  // -----------------------------------------------------------------------
  it('onCycleComplete callback fires after cycle', async () => {
    const village = createVillageWithConstitution(vm, cs);
    createActiveChief(ce, village.id, 'event coordinator');

    let callbackResult: GovernanceCycleResult | null = null;
    const callbackScheduler = new GovernanceScheduler({
      worldManager: wm,
      chiefEngine: ce,
      villageManager: vm,
      db,
      onCycleComplete: (result) => {
        callbackResult = result;
      },
    });

    await callbackScheduler.runOnce();

    expect(callbackResult).not.toBeNull();
    expect(callbackResult!.cycle_id).toMatch(/^cycle-/);
    expect(callbackResult!.villages_processed).toBe(1);
  });

  // -----------------------------------------------------------------------
  // 11. Multi-village support
  // -----------------------------------------------------------------------
  it('processes all active villages', async () => {
    const village1 = createVillageWithConstitution(vm, cs, 'Village Alpha');
    const village2 = createVillageWithConstitution(vm, cs, 'Village Beta');
    createActiveChief(ce, village1.id, 'event coordinator', 'Chief-A');
    createActiveChief(ce, village2.id, 'event coordinator', 'Chief-B');

    const result = await scheduler.runOnce();

    expect(result.villages_processed).toBe(2);
    expect(result.chief_results).toHaveLength(2);
  });

  // -----------------------------------------------------------------------
  // 12. Empty village (no chiefs) returns zero totals
  // -----------------------------------------------------------------------
  it('handles village with no chiefs gracefully', async () => {
    createVillageWithConstitution(vm, cs, 'Empty Village');

    const result = await scheduler.runOnce();

    expect(result.villages_processed).toBe(1);
    expect(result.chief_results).toHaveLength(0);
    expect(result.total_proposals).toBe(0);
    expect(result.total_applied).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // 13. Audit log entry created per cycle (THY-07)
  // -----------------------------------------------------------------------
  it('creates audit log entry per cycle', async () => {
    const village = createVillageWithConstitution(vm, cs);
    createActiveChief(ce, village.id, 'event coordinator');

    const result = await scheduler.runOnce();

    // Check audit_log for this cycle
    const auditRow = db.prepare(
      "SELECT * FROM audit_log WHERE entity_type = 'governance' AND entity_id = ? AND action = 'cycle_complete'"
    ).get(result.cycle_id) as Record<string, unknown> | null;

    expect(auditRow).not.toBeNull();
    expect(auditRow!.actor).toBe('scheduler');
    const payload = JSON.parse(auditRow!.payload as string) as Record<string, unknown>;
    expect(payload.villages_processed).toBe(1);
  });

  // -----------------------------------------------------------------------
  // 14. Pipeline dispatch: chief with pipelines dispatches to Karvi
  // -----------------------------------------------------------------------
  it('dispatches pipeline chiefs to Karvi instead of local execution', async () => {
    const village = createVillageWithConstitution(vm, cs);

    // Create a chief with pipelines
    const pipelineChief = ce.create(village.id, {
      name: 'PipelineChief',
      role: 'economy advisor',
      permissions: ['dispatch_task'],
      skills: [],
      pipelines: ['market-analysis'],
    }, 'test-actor');

    const dispatches: unknown[] = [];
    const mockBridge = {
      dispatchProject: async (input: unknown) => {
        dispatches.push(input);
        return { ok: true, title: 'test', taskCount: 1 } as KarviProjectResponse;
      },
    } as unknown as KarviBridge;

    const pipelineScheduler = new GovernanceScheduler({
      worldManager: wm,
      chiefEngine: ce,
      villageManager: vm,
      db,
      karviBridge: mockBridge,
    });

    const result = await pipelineScheduler.runOnce();

    // Pipeline chief should NOT produce local chief_results
    expect(result.chief_results).toHaveLength(0);
    // Pipeline dispatches should be recorded
    expect(result.pipeline_dispatches).toHaveLength(1);
    expect(result.pipeline_dispatches[0].pipeline_id).toBe('market-analysis');
    expect(result.pipeline_dispatches[0].dispatched).toBe(true);
    expect(result.pipeline_dispatches[0].chief_id).toBe(pipelineChief.id);
    expect(dispatches).toHaveLength(1);
  });

  // -----------------------------------------------------------------------
  // 15. No-pipeline chief uses local rule-based (unchanged)
  // -----------------------------------------------------------------------
  it('uses local rule-based for chiefs without pipelines even with KarviBridge', async () => {
    const village = createVillageWithConstitution(vm, cs);
    createActiveChief(ce, village.id, 'event coordinator');

    const mockBridge = {
      dispatchProject: async () => ({ ok: true, title: 'test', taskCount: 1 }),
    } as unknown as KarviBridge;

    const pipelineScheduler = new GovernanceScheduler({
      worldManager: wm,
      chiefEngine: ce,
      villageManager: vm,
      db,
      karviBridge: mockBridge,
    });

    const result = await pipelineScheduler.runOnce();

    // Should use local execution
    expect(result.chief_results.length).toBeGreaterThanOrEqual(1);
    expect(result.pipeline_dispatches).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // 16. Mixed village: pipeline + local chiefs coexist
  // -----------------------------------------------------------------------
  it('handles mixed pipeline and local chiefs in same village', async () => {
    const village = createVillageWithConstitution(vm, cs);

    // Local chief (no pipelines)
    createActiveChief(ce, village.id, 'event coordinator', 'LocalChief');

    // Pipeline chief
    ce.create(village.id, {
      name: 'PipelineChief',
      role: 'economy advisor',
      permissions: ['dispatch_task'],
      skills: [],
      pipelines: ['budget-optimizer'],
    }, 'test-actor');

    const mockBridge = {
      dispatchProject: async () => ({ ok: true, title: 'test', taskCount: 1 } as KarviProjectResponse),
    } as unknown as KarviBridge;

    const pipelineScheduler = new GovernanceScheduler({
      worldManager: wm,
      chiefEngine: ce,
      villageManager: vm,
      db,
      karviBridge: mockBridge,
    });

    const result = await pipelineScheduler.runOnce();

    // Local chief produces chief_results
    expect(result.chief_results).toHaveLength(1);
    // Pipeline chief produces pipeline_dispatches
    expect(result.pipeline_dispatches).toHaveLength(1);
    expect(result.pipeline_dispatches[0].pipeline_id).toBe('budget-optimizer');
  });

  // -----------------------------------------------------------------------
  // 17. Pipeline chief without KarviBridge logs skip audit
  // -----------------------------------------------------------------------
  it('skips pipeline chief when no KarviBridge and logs audit', async () => {
    const village = createVillageWithConstitution(vm, cs);
    ce.create(village.id, {
      name: 'OrphanPipelineChief',
      role: 'economy advisor',
      permissions: ['dispatch_task'],
      skills: [],
      pipelines: ['orphan-pipeline'],
    }, 'test-actor');

    // No karviBridge in scheduler (default setup has none)
    const result = await scheduler.runOnce();

    // No pipeline dispatches and no local execution for pipeline chief
    expect(result.pipeline_dispatches).toHaveLength(0);
    expect(result.chief_results).toHaveLength(0);

    // Check audit log for skip
    const skipAudit = db.prepare(
      "SELECT * FROM audit_log WHERE entity_type = 'governance' AND action = 'pipeline_skip'"
    ).get() as Record<string, unknown> | null;
    expect(skipAudit).not.toBeNull();
  });

  // -----------------------------------------------------------------------
  // 18. pipeline_dispatches field always present in result
  // -----------------------------------------------------------------------
  it('pipeline_dispatches field is always present even when empty', async () => {
    createVillageWithConstitution(vm, cs, 'Empty Village');
    const result = await scheduler.runOnce();
    expect(result.pipeline_dispatches).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // 19. useHeartbeat=true: local chief routes through adapter registry
  // -----------------------------------------------------------------------
  it('useHeartbeat=true routes local chief through adapter registry', async () => {
    const village = createVillageWithConstitution(vm, cs);
    createActiveChief(ce, village.id, 'event coordinator', 'HeartbeatLocalChief');

    const heartbeatScheduler = new GovernanceScheduler({
      worldManager: wm,
      chiefEngine: ce,
      villageManager: vm,
      db,
      useHeartbeat: true,
    });

    const result = await heartbeatScheduler.runOnce();

    // Should still produce chief_results via heartbeat path
    expect(result.chief_results).toHaveLength(1);
    expect(result.villages_processed).toBe(1);
    // Pipeline dispatches should be empty (no pipeline chief)
    expect(result.pipeline_dispatches).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // 20. useHeartbeat=true: karvi chief routes through KarviPipelineAdapter
  // -----------------------------------------------------------------------
  it('useHeartbeat=true routes karvi chief through KarviPipelineAdapter', async () => {
    const village = createVillageWithConstitution(vm, cs);
    ce.create(village.id, {
      name: 'HeartbeatKarviChief',
      role: 'economy advisor',
      permissions: ['dispatch_task'],
      skills: [],
      pipelines: ['market-analysis'],
      adapter_type: 'karvi',
    }, 'test-actor');

    const dispatches: unknown[] = [];
    const mockBridge = {
      dispatchProject: async (input: unknown) => {
        dispatches.push(input);
        return { ok: true, title: 'test', taskCount: 1 } as KarviProjectResponse;
      },
    } as unknown as KarviBridge;

    const heartbeatScheduler = new GovernanceScheduler({
      worldManager: wm,
      chiefEngine: ce,
      villageManager: vm,
      db,
      karviBridge: mockBridge,
      useHeartbeat: true,
    });

    const result = await heartbeatScheduler.runOnce();

    // Karvi chief should route through adapter, producing chief_results
    expect(result.chief_results).toHaveLength(1);
    expect(dispatches).toHaveLength(1);
    // No legacy pipeline_dispatches (heartbeat path handles it)
    expect(result.pipeline_dispatches).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // 21. useHeartbeat=true: mixed local + karvi chiefs
  // -----------------------------------------------------------------------
  it('useHeartbeat=true handles mixed local and karvi chiefs', async () => {
    const village = createVillageWithConstitution(vm, cs);
    createActiveChief(ce, village.id, 'event coordinator', 'LocalChief');
    ce.create(village.id, {
      name: 'KarviChief',
      role: 'economy advisor',
      permissions: ['dispatch_task'],
      skills: [],
      pipelines: ['budget-opt'],
      adapter_type: 'karvi',
    }, 'test-actor');

    const dispatches: unknown[] = [];
    const mockBridge = {
      dispatchProject: async (input: unknown) => {
        dispatches.push(input);
        return { ok: true, title: 'test', taskCount: 1 } as KarviProjectResponse;
      },
    } as unknown as KarviBridge;

    const heartbeatScheduler = new GovernanceScheduler({
      worldManager: wm,
      chiefEngine: ce,
      villageManager: vm,
      db,
      karviBridge: mockBridge,
      useHeartbeat: true,
    });

    const result = await heartbeatScheduler.runOnce();

    // Both chiefs routed through adapter registry
    expect(result.chief_results).toHaveLength(2);
    // One pipeline dispatch from karvi adapter
    expect(dispatches).toHaveLength(1);
  });

  // -----------------------------------------------------------------------
  // 22. Coordinated execution: local chiefs run in priority order (#200)
  // -----------------------------------------------------------------------
  it('runOnce() executes local chiefs in priority order', async () => {
    const village = createVillageWithConstitution(vm, cs);

    // Create chiefs in reverse priority order
    const growthChief = createActiveChief(ce, village.id, 'growth analyst', 'GrowthChief');
    const eventChief = createActiveChief(ce, village.id, 'event coordinator', 'EventChief');

    const result = await scheduler.runOnce();

    // Both should be executed
    expect(result.chief_results).toHaveLength(2);
    // Event (priority 4) should come before Growth (priority 5)
    expect(result.chief_results[0].chief_id).toBe(eventChief.id);
    expect(result.chief_results[1].chief_id).toBe(growthChief.id);
  });

  // -----------------------------------------------------------------------
  // 23. Mixed pipeline + local chiefs: pipeline dispatches, local coordinates (#200)
  // -----------------------------------------------------------------------
  it('separates pipeline chiefs from local coordinated execution', async () => {
    const village = createVillageWithConstitution(vm, cs);

    // Local chiefs
    createActiveChief(ce, village.id, 'event coordinator', 'LocalEvent');
    createActiveChief(ce, village.id, 'safety officer', 'LocalSafety');

    // Pipeline chief
    ce.create(village.id, {
      name: 'PipelineEconomy',
      role: 'economy advisor',
      permissions: ['dispatch_task'],
      skills: [],
      pipelines: ['budget-optimizer'],
    }, 'test-actor');

    const mockBridge = {
      dispatchProject: async () => ({ ok: true, title: 'test', taskCount: 1 } as KarviProjectResponse),
    } as unknown as KarviBridge;

    const pipelineScheduler = new GovernanceScheduler({
      worldManager: wm,
      chiefEngine: ce,
      villageManager: vm,
      db,
      karviBridge: mockBridge,
    });

    const result = await pipelineScheduler.runOnce();

    // Pipeline chief dispatched
    expect(result.pipeline_dispatches).toHaveLength(1);
    // Local chiefs coordinated (2 results)
    expect(result.chief_results).toHaveLength(2);
  });
});
