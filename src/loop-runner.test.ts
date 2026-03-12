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
    // runLoop runs async — wait a tick for it to complete
    await new Promise((resolve) => setTimeout(resolve, 50));
    const updated = loopRunner.get(cycle.id);
    // Phase 0 decide() always returns null → completed
    expect(['completed', 'running']).toContain(updated?.status);
  });

  it('observe: returns audit log entries', () => {
    // startCycle creates audit entries
    loopRunner.startCycle(villageId, { chief_id: chiefId });
    const obs = loopRunner.observe(villageId);
    expect(obs.length).toBeGreaterThan(0);
  });

  it('decide: returns null in Phase 0', async () => {
    const result = await loopRunner.decide(
      { id: chiefId, village_id: villageId, name: 'test', role: 'r', version: 1, status: 'active', skills: [], permissions: [], personality: { risk_tolerance: 'moderate', communication_style: 'concise', decision_speed: 'fast' }, constraints: [], created_at: '', updated_at: '' },
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
      const chief = { id: chiefId, village_id: villageId, name: 'test', role: 'r', version: 1, status: 'active' as const, skills: [], permissions: [], personality: { risk_tolerance: 'moderate' as const, communication_style: 'concise' as const, decision_speed: 'fast' as const }, constraints: [], created_at: '', updated_at: '' };

      await runner.decide(chief, [], [{ some: 'obs' }], villageId);

      expect(queryCalled).toBe(true);
      expect(queryOpts).toEqual({ domain: 'law', keyword: villageId });
    });

    it('decide works without EddaBridge (graceful degradation)', async () => {
      // loopRunner from beforeEach has no eddaBridge
      const chief = { id: chiefId, village_id: villageId, name: 'test', role: 'r', version: 1, status: 'active' as const, skills: [], permissions: [], personality: { risk_tolerance: 'moderate' as const, communication_style: 'concise' as const, decision_speed: 'fast' as const }, constraints: [], created_at: '', updated_at: '' };

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
      const chief = { id: chiefId, village_id: villageId, name: 'test', role: 'r', version: 1, status: 'active' as const, skills: [], permissions: [], personality: { risk_tolerance: 'moderate' as const, communication_style: 'concise' as const, decision_speed: 'fast' as const }, constraints: [], created_at: '', updated_at: '' };

      // Should not throw — graceful degradation
      const result = await runner.decide(chief, [], [{ some: 'obs' }], villageId);
      expect(result).toBeNull();
    });
  });

  describe('observeKarviEvents', () => {
    it('returns karvi_event entries from audit_log', () => {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO audit_log (entity_type, entity_id, action, payload, actor, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('karvi_event', 'task-001', 'task_completed', JSON.stringify({ result: 'success' }), 'karvi', now);

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
        `).run('karvi_event', `task-${i}`, 'task_completed', '{}', 'karvi', now);
      }
      const events = loopRunner.observeKarviEvents(villageId, 3);
      expect(events).toHaveLength(3);
    });
  });

  describe('observe with karvi events', () => {
    it('merges karvi events into observe results', () => {
      loopRunner.startCycle(villageId, { chief_id: chiefId });

      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO audit_log (entity_type, entity_id, action, payload, actor, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('karvi_event', 'task-abc', 'task_started', JSON.stringify({ agent: 'bot-1' }), 'karvi', now);

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
      `).run('karvi_event', 'task-future', 'task_completed', '{}', 'karvi', futureTime);

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

  describe('runLoop error handling (issue #31)', () => {
    it('runLoop error transitions cycle to aborted with error reason', async () => {
      const cycle = loopRunner.startCycle(villageId, { chief_id: chiefId });

      // Override observe to throw, simulating a DB error mid-loop
      loopRunner.observe = () => { throw new Error('DB read failed'); };

      // Wait for async runLoop to process
      await new Promise((resolve) => setTimeout(resolve, 50));

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
      await new Promise((resolve) => setTimeout(resolve, 50));

      const updated = loopRunner.get(cycle.id);
      expect(updated?.status).toBe('aborted');
    });
  });
});
