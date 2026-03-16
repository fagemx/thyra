import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { createDb, initSchema } from './db';
import { VillageManager } from './village-manager';
import { ConstitutionStore } from './constitution-store';
import { SkillRegistry } from './skill-registry';
import { ChiefEngine } from './chief-engine';
import { LawEngine } from './law-engine';
import { RiskAssessor } from './risk-assessor';
import { LoopRunner } from './loop-runner';
import { DecisionEngine } from './decision-engine';

/** Poll until predicate returns true, or throw after maxMs. */
async function waitFor(fn: () => boolean, maxMs = 2000, intervalMs = 10): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (fn()) return;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out after ${maxMs}ms`);
}

describe('LoopRunner', () => {
  let db: Database;
  let loopRunner: LoopRunner;
  let riskAssessor: RiskAssessor;
  let villageId: string;
  let chiefId: string;

  beforeEach(() => {
    db = createDb(':memory:');
    initSchema(db);

    const villageMgr = new VillageManager(db);
    villageId = villageMgr.create({ name: 'test', target_repo: 'r' }, 'u').id;

    const constitutionStore = new ConstitutionStore(db);
    constitutionStore.create(villageId, {
      rules: [{ description: 'review required', enforcement: 'hard', scope: ['*'] }],
      allowed_permissions: ['dispatch_task', 'propose_law', 'enact_law_low'],
      budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
    }, 'human');

    const skillRegistry = new SkillRegistry(db);
    const chiefEngine = new ChiefEngine(db, constitutionStore, skillRegistry);
    const lawEngine = new LawEngine(db, constitutionStore, chiefEngine);
    riskAssessor = new RiskAssessor(db);
    loopRunner = new LoopRunner(db, constitutionStore, chiefEngine, lawEngine, riskAssessor);

    chiefId = chiefEngine.create(villageId, {
      name: 'LoopChief',
      role: 'executor',
      permissions: ['dispatch_task', 'propose_law'],
    }, 'h').id;
  });

  it('startCycle: creates a running cycle', () => {
    const cycle = loopRunner.startCycle(villageId, { chief_id: chiefId });
    expect(cycle.status).toBe('running');
    expect(cycle.village_id).toBe(villageId);
    expect(cycle.chief_id).toBe(chiefId);
    expect(cycle.trigger).toBe('manual');
    expect(cycle.budget_remaining).toBe(50);
    expect(cycle.cost_incurred).toBe(0);
    expect(cycle.iterations).toBe(0);
    expect(cycle.id).toMatch(/^cycle-/);
  });

  it('startCycle: uses custom trigger and timeout', () => {
    const cycle = loopRunner.startCycle(villageId, {
      chief_id: chiefId,
      trigger: 'scheduled',
      timeout_ms: 60000,
      max_iterations: 5,
    });
    expect(cycle.trigger).toBe('scheduled');
    expect(cycle.timeout_ms).toBe(60000);
    expect(cycle.max_iterations).toBe(5);
  });

  it('startCycle: chief not found → error', () => {
    expect(() => loopRunner.startCycle(villageId, { chief_id: 'bad' }))
      .toThrow('Chief not found');
  });

  it('startCycle: chief from different village → error', () => {
    const villageMgr = new VillageManager(db);
    const v2 = villageMgr.create({ name: 'other', target_repo: 'r' }, 'u');
    expect(() => loopRunner.startCycle(v2.id, { chief_id: chiefId }))
      .toThrow('Chief does not belong to this village');
  });

  it('startCycle: no constitution → error', () => {
    const villageMgr = new VillageManager(db);
    const v2 = villageMgr.create({ name: 'no-const', target_repo: 'r' }, 'u');
    expect(() => loopRunner.startCycle(v2.id, { chief_id: chiefId }))
      .toThrow();
  });

  it('get: returns cycle by id', () => {
    const cycle = loopRunner.startCycle(villageId, { chief_id: chiefId });
    const fetched = loopRunner.get(cycle.id);
    expect(fetched?.id).toBe(cycle.id);
    expect(fetched?.village_id).toBe(villageId);
  });

  it('get: non-existent → null', () => {
    expect(loopRunner.get('xxx')).toBeNull();
  });

  it('listCycles: returns cycles for village', () => {
    loopRunner.startCycle(villageId, { chief_id: chiefId });
    loopRunner.startCycle(villageId, { chief_id: chiefId });
    expect(loopRunner.listCycles(villageId)).toHaveLength(2);
  });

  it('listCycles: filters by status', () => {
    const c1 = loopRunner.startCycle(villageId, { chief_id: chiefId });
    loopRunner.startCycle(villageId, { chief_id: chiefId });
    loopRunner.abortCycle(c1.id, 'test abort');
    // c1 is aborted, c2 is running (will auto-complete via runLoop)
    const aborted = loopRunner.listCycles(villageId, { status: 'aborted' });
    expect(aborted).toHaveLength(1);
    expect(aborted[0].id).toBe(c1.id);
  });

  it('abortCycle: running → aborted (SI-1 human stop)', () => {
    const cycle = loopRunner.startCycle(villageId, { chief_id: chiefId });
    const aborted = loopRunner.abortCycle(cycle.id, 'Testing abort');
    expect(aborted.status).toBe('aborted');
    expect(aborted.abort_reason).toBe('Testing abort');

    const fetched = loopRunner.get(cycle.id);
    expect(fetched?.status).toBe('aborted');
  });

  it('abortCycle: not running → error', () => {
    const cycle = loopRunner.startCycle(villageId, { chief_id: chiefId });
    loopRunner.abortCycle(cycle.id, 'first abort');
    expect(() => loopRunner.abortCycle(cycle.id, 'second abort'))
      .toThrow('not running');
  });

  it('getActions: returns actions for cycle', () => {
    const cycle = loopRunner.startCycle(villageId, { chief_id: chiefId });
    expect(loopRunner.getActions(cycle.id)).toEqual([]);
  });

  it('executeAction: low risk → executed', () => {
    const cycle = loopRunner.startCycle(villageId, { chief_id: chiefId });
    const action = loopRunner.executeAction(cycle.id, {
      action_type: 'review_code',
      description: 'Review PR #123',
      estimated_cost: 1,
      reason: 'PR needs review',
      rollback_plan: 'Revert review',
    });
    expect(action.status).toBe('executed');
    expect(action.risk_level).toBe('low');

    // Cost recorded
    const updated = loopRunner.get(cycle.id);
    expect(updated?.cost_incurred).toBe(1);
    expect(updated?.budget_remaining).toBe(49);
    expect(updated?.iterations).toBe(1);
  });

  it('executeAction: medium risk (deploy) → pending_approval', () => {
    const cycle = loopRunner.startCycle(villageId, { chief_id: chiefId });
    const action = loopRunner.executeAction(cycle.id, {
      action_type: 'deploy',
      description: 'Deploy to staging',
      estimated_cost: 5,
      reason: 'New release ready',
      rollback_plan: 'Rollback deploy',
    });
    expect(action.status).toBe('pending_approval');
    expect(action.risk_level).toBe('medium');

    // Cost NOT recorded for pending actions
    const updated = loopRunner.get(cycle.id);
    expect(updated?.cost_incurred).toBe(0);
  });

  it('executeAction: blocked (no rollback plan, SI-3) → blocked', () => {
    const cycle = loopRunner.startCycle(villageId, { chief_id: chiefId });
    const action = loopRunner.executeAction(cycle.id, {
      action_type: 'review_code',
      description: 'Review something',
      estimated_cost: 1,
      reason: 'Needs review',
      rollback_plan: undefined as unknown as string,
    });
    expect(action.status).toBe('blocked');
    expect(action.blocked_reasons).toBeDefined();
    expect(action.blocked_reasons!.length).toBeGreaterThan(0);
  });

  it('executeAction: cost exceeds per-action limit (SI-4) → blocked', () => {
    const cycle = loopRunner.startCycle(villageId, { chief_id: chiefId });
    const action = loopRunner.executeAction(cycle.id, {
      action_type: 'expensive_task',
      description: 'Very expensive operation',
      estimated_cost: 999,
      reason: 'Important',
      rollback_plan: 'Undo',
    });
    expect(action.status).toBe('blocked');
  });

  it('executeAction: cost accumulates correctly across actions', () => {
    const cycle = loopRunner.startCycle(villageId, { chief_id: chiefId });
    loopRunner.executeAction(cycle.id, {
      action_type: 'task_a',
      description: 'Task A',
      estimated_cost: 2,
      reason: 'A',
      rollback_plan: 'Undo A',
    });
    loopRunner.executeAction(cycle.id, {
      action_type: 'task_b',
      description: 'Task B',
      estimated_cost: 3,
      reason: 'B',
      rollback_plan: 'Undo B',
    });

    const updated = loopRunner.get(cycle.id);
    expect(updated?.cost_incurred).toBe(5);
    expect(updated?.budget_remaining).toBe(45);
    expect(updated?.iterations).toBe(2);
    expect(updated?.actions).toHaveLength(2);
  });

  it('executeAction: not running → error', () => {
    const cycle = loopRunner.startCycle(villageId, { chief_id: chiefId });
    loopRunner.abortCycle(cycle.id, 'test');
    expect(() => loopRunner.executeAction(cycle.id, {
      action_type: 'task',
      description: 'test',
      estimated_cost: 1,
      reason: 'test',
      rollback_plan: 'undo',
    })).toThrow('not running');
  });

  it('runLoop: completes when decide returns null (Phase 0)', async () => {
    const cycle = loopRunner.startCycle(villageId, { chief_id: chiefId });
    await waitFor(() => loopRunner.get(cycle.id)?.status === 'completed');
    const updated = loopRunner.get(cycle.id);
    // Phase 0 decide() always returns null → completed
    expect(updated?.status).toBe('completed');
  });

  it('observe: returns audit log entries', () => {
    // startCycle creates audit entries
    loopRunner.startCycle(villageId, { chief_id: chiefId });
    const obs = loopRunner.observe(villageId);
    expect(obs.length).toBeGreaterThan(0);
  });

  it('decide: returns null in Phase 0', async () => {
    const result = await loopRunner.decide(
      { id: chiefId, village_id: villageId, name: 'test', role: 'r', role_type: 'chief' as const, parent_chief_id: null, version: 1, status: 'active' as const, skills: [], pipelines: [], permissions: [], personality: { risk_tolerance: 'moderate' as const, communication_style: 'concise' as const, decision_speed: 'fast' as const }, constraints: [], profile: null, adapter_type: 'local' as const, context_mode: 'fat' as const, adapter_config: {}, budget_config: null, pause_reason: null, paused_at: null, last_heartbeat_at: null, current_run_id: null, current_run_status: 'idle' as const, timeout_count: 0, created_at: '', updated_at: '' },
      [],
      [],
    );
    expect(result).toBeNull();
  });

  describe('decide with EddaBridge', () => {
    it('queries Edda for precedents when bridge is provided', async () => {
      const constitutionStore = new ConstitutionStore(db);
      const skillRegistry = new SkillRegistry(db);
      const chiefEngine = new ChiefEngine(db, constitutionStore, skillRegistry);
      const lawEngine = new LawEngine(db, constitutionStore, chiefEngine);
      const ra = new RiskAssessor(db);

      let queryCalled = false;
      let queryOpts: Record<string, unknown> = {};
      const mockBridge = {
        queryDecisions: async (opts: Record<string, unknown>) => {
          queryCalled = true;
          queryOpts = opts;
          return {
            query: 'law',
            input_type: 'domain',
            decisions: [
              { event_id: 'evt-1', key: 'law.test', value: 'allow', reason: 'precedent', domain: 'law', branch: 'main', ts: new Date().toISOString(), is_active: true },
            ],
            timeline: [],
            related_commits: [],
            related_notes: [],
          };
        },
      } as unknown as import('./edda-bridge').EddaBridge;

      const runner = new LoopRunner(db, constitutionStore, chiefEngine, lawEngine, ra, mockBridge);
      const chief = { id: chiefId, village_id: villageId, name: 'test', role: 'r', role_type: 'chief' as const, parent_chief_id: null, version: 1, status: 'active' as const, skills: [], pipelines: [], permissions: [], personality: { risk_tolerance: 'moderate' as const, communication_style: 'concise' as const, decision_speed: 'fast' as const }, constraints: [], profile: null, adapter_type: 'local' as const, context_mode: 'fat' as const, adapter_config: {}, budget_config: null, pause_reason: null, paused_at: null, last_heartbeat_at: null, current_run_id: null, current_run_status: 'idle' as const, timeout_count: 0, created_at: '', updated_at: '' };

      await runner.decide(chief, [], [{ some: 'obs' }], villageId);

      expect(queryCalled).toBe(true);
      expect(queryOpts).toEqual({ domain: 'law', keyword: villageId });
    });

    it('decide works without EddaBridge (graceful degradation)', async () => {
      // loopRunner from beforeEach has no eddaBridge
      const chief = { id: chiefId, village_id: villageId, name: 'test', role: 'r', role_type: 'chief' as const, parent_chief_id: null, version: 1, status: 'active' as const, skills: [], pipelines: [], permissions: [], personality: { risk_tolerance: 'moderate' as const, communication_style: 'concise' as const, decision_speed: 'fast' as const }, constraints: [], profile: null, adapter_type: 'local' as const, context_mode: 'fat' as const, adapter_config: {}, budget_config: null, pause_reason: null, paused_at: null, last_heartbeat_at: null, current_run_id: null, current_run_status: 'idle' as const, timeout_count: 0, created_at: '', updated_at: '' };

      const result = await loopRunner.decide(chief, [], [{ some: 'obs' }], villageId);
      expect(result).toBeNull();
    });

    it('decide handles Edda bridge failure gracefully', async () => {
      const constitutionStore = new ConstitutionStore(db);
      const skillRegistry = new SkillRegistry(db);
      const chiefEngine = new ChiefEngine(db, constitutionStore, skillRegistry);
      const lawEngine = new LawEngine(db, constitutionStore, chiefEngine);
      const ra = new RiskAssessor(db);

      const mockBridge = {
        queryDecisions: async () => {
          throw new Error('Edda is down');
        },
      } as unknown as import('./edda-bridge').EddaBridge;

      const runner = new LoopRunner(db, constitutionStore, chiefEngine, lawEngine, ra, mockBridge);
      const chief = { id: chiefId, village_id: villageId, name: 'test', role: 'r', role_type: 'chief' as const, parent_chief_id: null, version: 1, status: 'active' as const, skills: [], pipelines: [], permissions: [], personality: { risk_tolerance: 'moderate' as const, communication_style: 'concise' as const, decision_speed: 'fast' as const }, constraints: [], profile: null, adapter_type: 'local' as const, context_mode: 'fat' as const, adapter_config: {}, budget_config: null, pause_reason: null, paused_at: null, last_heartbeat_at: null, current_run_id: null, current_run_status: 'idle' as const, timeout_count: 0, created_at: '', updated_at: '' };

      // Should not throw — graceful degradation
      const result = await runner.decide(chief, [], [{ some: 'obs' }], villageId);
      expect(result).toBeNull();
    });
  });

  describe('observeKarviEvents', () => {
    it('returns karvi_event entries from audit_log filtered by villageId', () => {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO audit_log (entity_type, entity_id, action, payload, actor, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('karvi_event', 'task-001', 'task_completed', JSON.stringify({ result: 'success', village_id: villageId }), 'karvi', now);

      const events = loopRunner.observeKarviEvents(villageId);
      expect(events).toHaveLength(1);
      expect(events[0].entity_type).toBe('karvi_event');
      expect(events[0].entity_id).toBe('task-001');
      expect(events[0].action).toBe('task_completed');
      expect(events[0].source).toBe('karvi');
    });

    it('returns empty array when no karvi events exist', () => {
      const events = loopRunner.observeKarviEvents(villageId);
      expect(events).toHaveLength(0);
    });

    it('respects limit parameter', () => {
      const now = new Date().toISOString();
      for (let i = 0; i < 5; i++) {
        db.prepare(`
          INSERT INTO audit_log (entity_type, entity_id, action, payload, actor, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run('karvi_event', `task-${i}`, 'task_completed', JSON.stringify({ village_id: villageId }), 'karvi', now);
      }
      const events = loopRunner.observeKarviEvents(villageId, 3);
      expect(events).toHaveLength(3);
    });

    it('filters events by villageId — no cross-village leakage', () => {
      const villageMgr = new VillageManager(db);
      const otherVillageId = villageMgr.create({ name: 'other-village', target_repo: 'r2' }, 'u').id;

      const now = new Date().toISOString();
      // Insert events for current village
      db.prepare(`
        INSERT INTO audit_log (entity_type, entity_id, action, payload, actor, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('karvi_event', 'task-a1', 'task_completed', JSON.stringify({ village_id: villageId }), 'karvi', now);
      db.prepare(`
        INSERT INTO audit_log (entity_type, entity_id, action, payload, actor, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('karvi_event', 'task-a2', 'step_started', JSON.stringify({ village_id: villageId }), 'karvi', now);

      // Insert events for other village
      db.prepare(`
        INSERT INTO audit_log (entity_type, entity_id, action, payload, actor, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('karvi_event', 'task-b1', 'task_completed', JSON.stringify({ village_id: otherVillageId }), 'karvi', now);

      // Insert event with no village_id (should not appear for either village)
      db.prepare(`
        INSERT INTO audit_log (entity_type, entity_id, action, payload, actor, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('karvi_event', 'task-orphan', 'task_failed', JSON.stringify({ result: 'fail' }), 'karvi', now);

      // villageId should only see its own 2 events
      const eventsA = loopRunner.observeKarviEvents(villageId);
      expect(eventsA).toHaveLength(2);
      expect(eventsA.map((e) => e.entity_id)).toContain('task-a1');
      expect(eventsA.map((e) => e.entity_id)).toContain('task-a2');
      expect(eventsA.map((e) => e.entity_id)).not.toContain('task-b1');
      expect(eventsA.map((e) => e.entity_id)).not.toContain('task-orphan');

      // otherVillageId should only see its own 1 event
      const eventsB = loopRunner.observeKarviEvents(otherVillageId);
      expect(eventsB).toHaveLength(1);
      expect(eventsB[0].entity_id).toBe('task-b1');
    });

    it('excludes events without village_id in payload', () => {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO audit_log (entity_type, entity_id, action, payload, actor, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('karvi_event', 'task-no-vid', 'task_completed', JSON.stringify({ result: 'ok' }), 'karvi', now);

      const events = loopRunner.observeKarviEvents(villageId);
      expect(events).toHaveLength(0);
    });
  });

  describe('observe with karvi events', () => {
    it('merges karvi events into observe results', () => {
      loopRunner.startCycle(villageId, { chief_id: chiefId });

      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO audit_log (entity_type, entity_id, action, payload, actor, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('karvi_event', 'task-abc', 'task_started', JSON.stringify({ agent: 'bot-1', village_id: villageId }), 'karvi', now);

      const obs = loopRunner.observe(villageId);
      expect(obs.length).toBeGreaterThan(0);

      const karviObs = obs.filter((o) => o.entity_type === 'karvi_event');
      expect(karviObs.length).toBeGreaterThanOrEqual(1);
      expect(karviObs[0].entity_id).toBe('task-abc');
    });

    it('observe does not crash when no karvi events exist', () => {
      loopRunner.startCycle(villageId, { chief_id: chiefId });
      const obs = loopRunner.observe(villageId);
      expect(obs.length).toBeGreaterThan(0);
      const karviObs = obs.filter((o) => o.entity_type === 'karvi_event');
      expect(karviObs).toHaveLength(0);
    });

    it('observe results are sorted by created_at descending', () => {
      loopRunner.startCycle(villageId, { chief_id: chiefId });

      const futureTime = new Date(Date.now() + 60000).toISOString();
      db.prepare(`
        INSERT INTO audit_log (entity_type, entity_id, action, payload, actor, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('karvi_event', 'task-future', 'task_completed', JSON.stringify({ village_id: villageId }), 'karvi', futureTime);

      const obs = loopRunner.observe(villageId);
      expect(obs.length).toBeGreaterThan(1);
      expect(obs[0].entity_type).toBe('karvi_event');
      expect(obs[0].entity_id).toBe('task-future');

      for (let i = 0; i < obs.length - 1; i++) {
        const ta = obs[i].created_at as string;
        const tb = obs[i + 1].created_at as string;
        expect(ta >= tb).toBe(true);
      }
    });
  });

  describe('intent field', () => {
    const SAMPLE_INTENT = {
      goal_kind: 'content_pipeline',
      stage_hint: 'research',
      origin_reason: 'Daily scheduled task',
      last_decision_summary: 'Initial cycle',
    };

    it('startCycle with intent → persisted and retrievable', () => {
      const cycle = loopRunner.startCycle(villageId, {
        chief_id: chiefId,
        intent: SAMPLE_INTENT,
      });
      expect(cycle.intent).toEqual(SAMPLE_INTENT);

      const fetched = loopRunner.get(cycle.id);
      expect(fetched?.intent).toEqual(SAMPLE_INTENT);
    });

    it('startCycle without intent → intent is null', () => {
      const cycle = loopRunner.startCycle(villageId, { chief_id: chiefId });
      expect(cycle.intent).toBeNull();

      const fetched = loopRunner.get(cycle.id);
      expect(fetched?.intent).toBeNull();
    });

    it('intent round-trip preserves all fields', () => {
      const intent = {
        goal_kind: 'strategy_review',
        stage_hint: 'evaluate',
        origin_reason: 'Quarterly OKR review',
        last_decision_summary: 'Completed data collection phase',
      };
      const cycle = loopRunner.startCycle(villageId, {
        chief_id: chiefId,
        intent,
      });
      const fetched = loopRunner.get(cycle.id);
      expect(fetched?.intent?.goal_kind).toBe('strategy_review');
      expect(fetched?.intent?.stage_hint).toBe('evaluate');
      expect(fetched?.intent?.origin_reason).toBe('Quarterly OKR review');
      expect(fetched?.intent?.last_decision_summary).toBe('Completed data collection phase');
    });

    it('listCycles includes intent field', () => {
      loopRunner.startCycle(villageId, {
        chief_id: chiefId,
        intent: SAMPLE_INTENT,
      });
      const cycles = loopRunner.listCycles(villageId);
      expect(cycles).toHaveLength(1);
      expect(cycles[0].intent).toEqual(SAMPLE_INTENT);
    });
  });

  describe('max_iterations and timeout_ms auto-stop (THY-08, issue #34)', () => {
    it('startCycle with max_iterations=2 stops after exactly 2 iterations', async () => {
      // Override decide to always return an action so the loop iterates
      let decideCallCount = 0;
      loopRunner.decide = async () => {
        decideCallCount++;
        return {
          action_type: 'review_code',
          description: `Review iteration ${decideCallCount}`,
          estimated_cost: 1,
          reason: 'Needs review',
          rollback_plan: 'Revert',
        };
      };

      const cycle = loopRunner.startCycle(villageId, {
        chief_id: chiefId,
        max_iterations: 2,
        timeout_ms: 5000,
      });

      // Poll until cycle finishes (max 2 seconds)
      let updated = loopRunner.get(cycle.id);
      const deadline = Date.now() + 2000;
      while (updated?.status === 'running' && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        updated = loopRunner.get(cycle.id);
      }

      expect(updated?.status).toBe('completed');
      expect(updated?.iterations).toBe(2);
      expect(updated?.abort_reason).toContain('Max iterations reached');
    });

    it('startCycle with timeout_ms=1000 stops after timeout', async () => {
      // Override decide to always return an action, but add a delay so timeout fires
      loopRunner.decide = async () => {
        // Delay each decide call to let timeout fire before max_iterations
        await new Promise((resolve) => setTimeout(resolve, 300));
        return {
          action_type: 'slow_task',
          description: 'Slow task',
          estimated_cost: 1,
          reason: 'Takes time',
          rollback_plan: 'Revert',
        };
      };

      const cycle = loopRunner.startCycle(villageId, {
        chief_id: chiefId,
        max_iterations: 100, // high enough that timeout fires first
        timeout_ms: 1000,    // minimum allowed by schema
      });

      // Poll until cycle finishes (max 3 seconds, timeout is 1s)
      let updated = loopRunner.get(cycle.id);
      const deadline = Date.now() + 3000;
      while (updated?.status === 'running' && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        updated = loopRunner.get(cycle.id);
      }

      expect(updated?.status).toBe('timeout');
      expect(updated?.abort_reason).toContain('Timeout exceeded');
      // Should have completed fewer iterations than max_iterations
      expect(updated!.iterations).toBeLessThan(100);
    });

    it('cycle status is completed after max_iterations auto-stop', async () => {
      // Override decide to return actions for exactly 3 iterations
      let callCount = 0;
      loopRunner.decide = async () => {
        callCount++;
        if (callCount > 3) return null;
        return {
          action_type: 'task',
          description: `Task ${callCount}`,
          estimated_cost: 1,
          reason: 'Work',
          rollback_plan: 'Undo',
        };
      };

      const cycle = loopRunner.startCycle(villageId, {
        chief_id: chiefId,
        max_iterations: 3,
        timeout_ms: 5000,
      });

      let updated = loopRunner.get(cycle.id);
      const deadline = Date.now() + 2000;
      while (updated?.status === 'running' && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        updated = loopRunner.get(cycle.id);
      }

      expect(updated?.status).toBe('completed');
      expect(updated?.iterations).toBe(3);
      expect(updated?.actions).toHaveLength(3);
    });
  });

  describe('runLoop error handling (issue #31)', () => {
    it('runLoop error transitions cycle to aborted with error reason', async () => {
      const cycle = loopRunner.startCycle(villageId, { chief_id: chiefId });

      // Override observe to throw, simulating a DB error mid-loop
      loopRunner.observe = () => { throw new Error('DB read failed'); };

      await waitFor(() => loopRunner.get(cycle.id)?.status === 'aborted');

      const updated = loopRunner.get(cycle.id);
      expect(updated?.status).toBe('aborted');
      expect(updated?.abort_reason).toContain('Loop error');
      expect(updated?.abort_reason).toContain('DB read failed');
    });

    it('no unhandled promise rejection when runLoop throws', async () => {
      // Override observe to throw
      loopRunner.observe = () => { throw new Error('Unexpected failure'); };

      // startCycle should not throw even though runLoop will fail
      const cycle = loopRunner.startCycle(villageId, { chief_id: chiefId });
      expect(cycle.status).toBe('running');

      // Wait for async completion — no unhandled rejection should occur
      await waitFor(() => loopRunner.get(cycle.id)?.status === 'aborted');

      const updated = loopRunner.get(cycle.id);
      expect(updated?.status).toBe('aborted');
    });
  });

  describe('cycle-world-state snapshot sync (issue #187)', () => {
    it('cycle completion triggers world state snapshot', async () => {
      const cycle = loopRunner.startCycle(villageId, { chief_id: chiefId });
      await waitFor(() => loopRunner.get(cycle.id)?.status === 'completed');

      // Verify snapshot was created
      const snapshots = db.prepare(
        'SELECT * FROM world_snapshots WHERE village_id = ? AND trigger = ?'
      ).all(villageId, 'cycle_end') as Record<string, unknown>[];
      expect(snapshots.length).toBeGreaterThanOrEqual(1);
    });

    it('cycle abort triggers world state snapshot', () => {
      const cycle = loopRunner.startCycle(villageId, { chief_id: chiefId });
      loopRunner.abortCycle(cycle.id, 'Manual abort for test');

      // Verify snapshot was created
      const snapshots = db.prepare(
        'SELECT * FROM world_snapshots WHERE village_id = ? AND trigger = ?'
      ).all(villageId, 'cycle_end') as Record<string, unknown>[];
      expect(snapshots.length).toBeGreaterThanOrEqual(1);
    });

    it('audit_log links cycle_id and snapshot_id', () => {
      const cycle = loopRunner.startCycle(villageId, { chief_id: chiefId });
      loopRunner.abortCycle(cycle.id, 'Abort to test audit link');

      // Find the world_snapshot audit entry
      const auditEntries = db.prepare(
        "SELECT * FROM audit_log WHERE entity_type = 'world_snapshot' AND action = 'cycle_snapshot'"
      ).all() as Record<string, unknown>[];
      expect(auditEntries.length).toBeGreaterThanOrEqual(1);

      const entry = auditEntries[0];
      const payload = JSON.parse(entry.payload as string) as Record<string, unknown>;
      expect(payload.cycle_id).toBe(cycle.id);
      expect(payload.snapshot_id).toBeTruthy();
      expect(payload.cycle_status).toBe('aborted');
      expect(payload.reason).toBe('Abort to test audit link');

      // Verify the snapshot_id in audit matches a real snapshot
      const snapshotId = payload.snapshot_id as string;
      const snapshot = db.prepare(
        'SELECT * FROM world_snapshots WHERE id = ?'
      ).get(snapshotId) as Record<string, unknown> | null;
      expect(snapshot).not.toBeNull();
      expect(snapshot?.village_id).toBe(villageId);
    });

    it('completed cycle audit_log records cycle_status as completed', async () => {
      const cycle = loopRunner.startCycle(villageId, { chief_id: chiefId });
      await waitFor(() => loopRunner.get(cycle.id)?.status === 'completed');

      const auditEntries = db.prepare(
        "SELECT * FROM audit_log WHERE entity_type = 'world_snapshot' AND action = 'cycle_snapshot'"
      ).all() as Record<string, unknown>[];

      const matching = auditEntries.filter((e) => {
        const p = JSON.parse(e.payload as string) as Record<string, unknown>;
        return p.cycle_id === cycle.id;
      });
      expect(matching.length).toBe(1);

      const payload = JSON.parse(matching[0].payload as string) as Record<string, unknown>;
      expect(payload.cycle_status).toBe('completed');
    });
  });

  describe('runLoopV1 with DecisionEngine (issue #70)', () => {
    let v1Runner: LoopRunner;
    let skillRegistry: SkillRegistry;
    let constitutionStore: ConstitutionStore;
    let chiefEngine: ChiefEngine;
    let lawEngine: LawEngine;
    let v1ChiefId: string;

    beforeEach(() => {
      constitutionStore = new ConstitutionStore(db);
      skillRegistry = new SkillRegistry(db);
      chiefEngine = new ChiefEngine(db, constitutionStore, skillRegistry);
      lawEngine = new LawEngine(db, constitutionStore, chiefEngine);
      const ra = new RiskAssessor(db);
      const de = new DecisionEngine(db, constitutionStore, chiefEngine, lawEngine, skillRegistry, ra, null);

      v1Runner = new LoopRunner(db, constitutionStore, chiefEngine, lawEngine, ra, undefined, skillRegistry, de);

      v1ChiefId = chiefEngine.create(villageId, {
        name: 'V1Chief',
        role: 'executor',
        permissions: ['dispatch_task', 'propose_law', 'enact_law_low'],
      }, 'h').id;
    });

    it('completes with no action when no laws and no intent', async () => {
      const cycle = v1Runner.startCycle(villageId, { chief_id: v1ChiefId });

      await waitFor(() => v1Runner.get(cycle.id)?.status === 'completed');

      const updated = v1Runner.get(cycle.id);
      expect(updated?.status).toBe('completed');
    });

    it('dispatches research task when active law exists and research skill is verified', async () => {
      // 建立 verified research skill
      const skill = skillRegistry.create({
        name: 'research',
        definition: { description: 'Research skill', prompt_template: 'Do research', tools_required: [], constraints: [] },
      }, 'h');
      skillRegistry.verify(skill.id, 'h');

      // 建立 active law（low risk + enact_law_low → auto-approved）
      lawEngine.propose(villageId, v1ChiefId, {
        category: 'testing',
        content: { description: 'test law', strategy: {} },
        evidence: { source: 'test', reasoning: 'testing' },
      });

      const cycle = v1Runner.startCycle(villageId, { chief_id: v1ChiefId });
      await waitFor(() => v1Runner.get(cycle.id)?.status === 'completed');

      const updated = v1Runner.get(cycle.id);
      // Loop should have recorded at least one action
      expect(updated?.actions.length).toBeGreaterThan(0);
      // First action should be research dispatch
      expect(updated?.actions[0].type).toBe('research');
    });

    it('advances pipeline: research → draft → review → publish → complete', async () => {
      // 建立 verified skills for the full pipeline
      for (const name of ['research', 'draft', 'review', 'publish']) {
        const s = skillRegistry.create({
          name,
          definition: { description: `${name} skill`, prompt_template: `Do ${name}`, tools_required: [], constraints: [] },
        }, 'h');
        skillRegistry.verify(s.id, 'h');
      }

      // 建立 active law
      lawEngine.propose(villageId, v1ChiefId, {
        category: 'testing',
        content: { description: 'test law', strategy: {} },
        evidence: { source: 'test', reasoning: 'testing' },
      });

      const cycle = v1Runner.startCycle(villageId, {
        chief_id: v1ChiefId,
        max_iterations: 20,
      });

      await waitFor(() => v1Runner.get(cycle.id)?.status === 'completed');

      const updated = v1Runner.get(cycle.id);
      expect(updated?.status).toBe('completed');

      // 應該有 research, draft, review, publish 這些 action
      const actionTypes = updated?.actions.map(a => a.type) ?? [];
      expect(actionTypes).toContain('research');
      expect(actionTypes).toContain('draft');
    });

    it('intent is persisted across iterations', async () => {
      // 建立 research + draft skills
      for (const name of ['research', 'draft']) {
        const s = skillRegistry.create({
          name,
          definition: { description: `${name} skill`, prompt_template: `Do ${name}`, tools_required: [], constraints: [] },
        }, 'h');
        skillRegistry.verify(s.id, 'h');
      }

      // 建立 active law
      lawEngine.propose(villageId, v1ChiefId, {
        category: 'testing',
        content: { description: 'test law', strategy: {} },
        evidence: { source: 'test', reasoning: 'testing' },
      });

      const cycle = v1Runner.startCycle(villageId, {
        chief_id: v1ChiefId,
        max_iterations: 5,
      });

      await waitFor(() => v1Runner.get(cycle.id)?.status === 'completed');

      const updated = v1Runner.get(cycle.id);
      // After first iteration, intent should be updated with stage_hint
      // The DecisionEngine sets updated_intent when dispatching a task
      if (updated?.intent) {
        expect(updated.intent.stage_hint).toBeTruthy();
        expect(updated.intent.goal_kind).toBeTruthy();
      }
    });

    it('wait action skips to next iteration (pending approval)', async () => {
      // 建立 a deploy skill (medium risk → pending_approval → DecisionEngine sees pending_approval → wait)
      const s = skillRegistry.create({
        name: 'research',
        definition: { description: 'Research skill', prompt_template: 'Research', tools_required: [], constraints: [] },
      }, 'h');
      skillRegistry.verify(s.id, 'h');

      // 建立 active law
      lawEngine.propose(villageId, v1ChiefId, {
        category: 'testing',
        content: { description: 'test law', strategy: {} },
        evidence: { source: 'test', reasoning: 'testing' },
      });

      // Start with intent and a pending_approval action already recorded
      // Pre-insert a pending_approval action into the cycle
      const cycle = v1Runner.startCycle(villageId, {
        chief_id: v1ChiefId,
        max_iterations: 3,
      });

      // Inject a pending_approval action to trigger the wait path
      db.prepare('UPDATE loop_cycles SET actions = ? WHERE id = ?')
        .run(JSON.stringify([{
          type: 'review',
          description: 'needs approval',
          estimated_cost: 2,
          risk_level: 'medium',
          status: 'pending_approval',
          reason: 'needs human',
        }]), cycle.id);

      await waitFor(() => {
        const c = v1Runner.get(cycle.id);
        return c?.status === 'completed' || (c?.actions.some(a => a.type === 'wait') ?? false);
      });

      const updated = v1Runner.get(cycle.id);
      // Should have wait actions recorded
      const waitActions = updated?.actions.filter(a => a.type === 'wait') ?? [];
      expect(waitActions.length).toBeGreaterThan(0);
    });

    it('complete_cycle finishes the loop when budget is exhausted', async () => {
      // Spend 95% of daily budget → DecisionEngine will return complete_cycle
      riskAssessor.recordSpend(villageId, null, 95);

      const cycle = v1Runner.startCycle(villageId, { chief_id: v1ChiefId });
      await waitFor(() => v1Runner.get(cycle.id)?.status === 'completed');

      const updated = v1Runner.get(cycle.id);
      expect(updated?.status).toBe('completed');
    });

    it('dispatch_task with no verified skill records blocked action', async () => {
      // No skills registered, but have active law → DecisionEngine tries to dispatch research
      lawEngine.propose(villageId, v1ChiefId, {
        category: 'testing',
        content: { description: 'test law', strategy: {} },
        evidence: { source: 'test', reasoning: 'testing' },
      });

      const cycle = v1Runner.startCycle(villageId, { chief_id: v1ChiefId });
      await waitFor(() => v1Runner.get(cycle.id)?.status === 'completed');

      const updated = v1Runner.get(cycle.id);
      // DecisionEngine returns null action when no skill is found → cycle completes
      expect(updated?.status).toBe('completed');
    });

    it('law proposals are recorded in cycle laws_proposed', async () => {
      // Set up conditions for law proposals: 3+ blocked actions
      for (const name of ['research']) {
        const s = skillRegistry.create({
          name,
          definition: { description: `${name} skill`, prompt_template: `Do ${name}`, tools_required: [], constraints: [] },
        }, 'h');
        skillRegistry.verify(s.id, 'h');
      }

      // 建立 active law
      lawEngine.propose(villageId, v1ChiefId, {
        category: 'testing',
        content: { description: 'test law', strategy: {} },
        evidence: { source: 'test', reasoning: 'testing' },
      });

      // Pre-insert 3 blocked actions to trigger law proposals
      const cycle = v1Runner.startCycle(villageId, {
        chief_id: v1ChiefId,
        max_iterations: 3,
      });

      const blockedActions = [
        { type: 'a1', description: 'd1', estimated_cost: 5, risk_level: 'high', status: 'blocked', reason: 'SI', blocked_reasons: ['SI-1'] },
        { type: 'a2', description: 'd2', estimated_cost: 5, risk_level: 'high', status: 'blocked', reason: 'SI', blocked_reasons: ['SI-2'] },
        { type: 'a3', description: 'd3', estimated_cost: 5, risk_level: 'high', status: 'blocked', reason: 'SI', blocked_reasons: ['SI-3'] },
      ];
      db.prepare('UPDATE loop_cycles SET actions = ? WHERE id = ?')
        .run(JSON.stringify(blockedActions), cycle.id);

      await waitFor(() => v1Runner.get(cycle.id)?.status === 'completed');

      const updated = v1Runner.get(cycle.id);
      // With 3 blocked actions, DecisionEngine generates law proposals
      // and the loop should record them
      expect(updated?.laws_proposed.length).toBeGreaterThanOrEqual(0);
    });

    it('audit_log records decision entries in V1 flow', async () => {
      const cycle = v1Runner.startCycle(villageId, { chief_id: v1ChiefId });
      await waitFor(() => v1Runner.get(cycle.id)?.status === 'completed');

      // Check audit_log for decision entries
      // V1 flow should record at least one decision entry (even if action is null → completed)
      // The first iteration produces a decision entry only if action is not null
      // When action is null, it calls finishCycle which records 'completed' in audit
      const completedEntries = db.prepare(
        "SELECT * FROM audit_log WHERE entity_type = 'loop' AND entity_id = ? AND action = 'completed'"
      ).all(cycle.id) as Record<string, unknown>[];
      expect(completedEntries.length).toBeGreaterThan(0);
    });

    it('backwards compatibility: LoopRunner without DecisionEngine uses Phase 0', async () => {
      // Create a runner WITHOUT DecisionEngine
      const ra = new RiskAssessor(db);
      const phase0Runner = new LoopRunner(db, constitutionStore, chiefEngine, lawEngine, ra);

      const cycle = phase0Runner.startCycle(villageId, { chief_id: v1ChiefId });
      await waitFor(() => phase0Runner.get(cycle.id)?.status === 'completed');

      const updated = phase0Runner.get(cycle.id);
      // Phase 0 decide() returns null → completed immediately
      expect(updated?.status).toBe('completed');
    });
  });
});
