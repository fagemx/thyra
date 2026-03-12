import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { createDb, initSchema } from './db';
import { VillageManager } from './village-manager';
import { ConstitutionStore } from './constitution-store';
import { SkillRegistry } from './skill-registry';
import { ChiefEngine } from './chief-engine';
import { LawEngine } from './law-engine';
import { RiskAssessor } from './risk-assessor';
import { DecisionEngine } from './decision-engine';
import type { LoopOutcome, CycleState } from './decision-engine';
import type { LoopAction } from './schemas/loop';

describe('DecisionEngine', () => {
  let db: Database;
  let engine: DecisionEngine;
  let constitutionStore: ConstitutionStore;
  let chiefEngine: ChiefEngine;
  let lawEngine: LawEngine;
  let skillRegistry: SkillRegistry;
  let riskAssessor: RiskAssessor;
  let villageId: string;
  let chiefId: string;

  const baseCycleState: CycleState = {
    cycle_id: 'cycle-test-1',
    iteration: 0,
    max_iterations: 10,
  };

  beforeEach(() => {
    db = createDb(':memory:');
    initSchema(db);

    const villageMgr = new VillageManager(db);
    villageId = villageMgr.create({ name: 'test-village', target_repo: 'fagemx/test' }, 'human').id;

    constitutionStore = new ConstitutionStore(db);
    constitutionStore.create(villageId, {
      rules: [
        { description: 'review required', enforcement: 'hard', scope: ['*'] },
        { description: 'no auto-deploy', enforcement: 'soft', scope: ['*'] },
      ],
      allowed_permissions: ['dispatch_task', 'propose_law', 'enact_law_low'],
      budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
    }, 'human');

    skillRegistry = new SkillRegistry(db);
    chiefEngine = new ChiefEngine(db, constitutionStore, skillRegistry);
    lawEngine = new LawEngine(db, constitutionStore, chiefEngine);
    riskAssessor = new RiskAssessor(db);

    chiefId = chiefEngine.create(villageId, {
      name: 'TestChief',
      role: 'governor',
      permissions: ['dispatch_task', 'propose_law'],
      constraints: [
        { type: 'must', description: 'log all decisions' },
        { type: 'avoid', description: 'risky deployments' },
      ],
    }, 'human').id;

    engine = new DecisionEngine(
      db, constitutionStore, chiefEngine, lawEngine,
      skillRegistry, riskAssessor, null,
    );
  });

  // -----------------------------------------------------------------------
  // 建構測試
  // -----------------------------------------------------------------------

  it('constructs without error', () => {
    expect(engine).toBeDefined();
  });

  it('constructs with null EddaBridge', () => {
    const e = new DecisionEngine(
      db, constitutionStore, chiefEngine, lawEngine,
      skillRegistry, riskAssessor, null,
    );
    expect(e).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // buildContext 測試
  // -----------------------------------------------------------------------

  describe('buildContext', () => {
    it('assembles complete context with v0.1 fields', async () => {
      const ctx = await engine.buildContext(villageId, chiefId, [], baseCycleState);

      expect(ctx.cycle_id).toBe('cycle-test-1');
      expect(ctx.village_id).toBe(villageId);
      expect(ctx.iteration).toBe(0);
      expect(ctx.max_iterations).toBe(10);
      expect(ctx.chief.id).toBe(chiefId);
      expect(ctx.chief.name).toBe('TestChief');
      expect(ctx.constitution.status).toBe('active');
      expect(ctx.active_laws).toHaveLength(0);
      expect(ctx.chief_skills).toHaveLength(0);
      expect(ctx.edda_precedents).toHaveLength(0);
      expect(ctx.edda_available).toBe(false);
      expect(ctx.last_action).toBeNull();
      expect(ctx.completed_action_types).toHaveLength(0);
      expect(ctx.pending_approvals).toBe(0);
      expect(ctx.blocked_count).toBe(0);
      expect(ctx.recent_rollbacks).toBe(0);
      expect(ctx.intent).toBeNull();
    });

    it('includes budget snapshot and budget_ratio', async () => {
      const ctx = await engine.buildContext(villageId, chiefId, [], baseCycleState);

      expect(ctx.budget.per_action_limit).toBe(10);
      expect(ctx.budget.per_day_limit).toBe(100);
      expect(ctx.budget.per_loop_limit).toBe(50);
      expect(ctx.budget.spent_today).toBe(0);
      expect(ctx.budget.spent_this_loop).toBe(0);
      expect(ctx.budget_ratio).toBe(1.0); // 100% remaining
    });

    it('budget_ratio decreases with spending', async () => {
      riskAssessor.recordSpend(villageId, null, 75);

      const ctx = await engine.buildContext(villageId, chiefId, [], baseCycleState);

      expect(ctx.budget_ratio).toBeCloseTo(0.25); // 25% remaining
    });

    it('includes observations in context', async () => {
      const obs = [{ type: 'test', data: 'value' }];
      const ctx = await engine.buildContext(villageId, chiefId, obs, {
        ...baseCycleState,
        iteration: 3,
      });

      expect(ctx.observations).toHaveLength(1);
      expect(ctx.observations[0]).toEqual({ type: 'test', data: 'value' });
      expect(ctx.iteration).toBe(3);
    });

    it('derives action stats from cycleState.actions', async () => {
      const actions: LoopAction[] = [
        { type: 'research', description: 'r', estimated_cost: 5, risk_level: 'low', status: 'executed', reason: 'ok' },
        { type: 'draft', description: 'd', estimated_cost: 3, risk_level: 'low', status: 'executed', reason: 'ok' },
        { type: 'review', description: 'rv', estimated_cost: 2, risk_level: 'medium', status: 'pending_approval', reason: 'needs human' },
        { type: 'deploy', description: 'dp', estimated_cost: 8, risk_level: 'high', status: 'blocked', reason: 'SI', blocked_reasons: ['SI-1'] },
      ];

      const ctx = await engine.buildContext(villageId, chiefId, [], {
        ...baseCycleState,
        actions,
      });

      expect(ctx.last_action?.type).toBe('deploy');
      expect(ctx.completed_action_types).toEqual(['research', 'draft']);
      expect(ctx.pending_approvals).toBe(1);
      expect(ctx.blocked_count).toBe(1);
    });

    it('includes active laws in context', async () => {
      chiefEngine.update(chiefId, {
        permissions: ['dispatch_task', 'propose_law', 'enact_law_low'],
      }, 'human');

      lawEngine.propose(villageId, chiefId, {
        category: 'testing',
        content: { description: 'test law', strategy: {} },
        evidence: { source: 'unit-test', reasoning: 'testing' },
      });

      const ctx = await engine.buildContext(villageId, chiefId, [], baseCycleState);

      expect(ctx.active_laws.length).toBeGreaterThanOrEqual(1);
    });

    it('includes chief skills when bound', async () => {
      const skill = skillRegistry.create({
        name: 'test-skill',
        definition: {
          description: 'A test skill',
          prompt_template: 'Do something',
          tools_required: [],
          constraints: [],
        },
      }, 'human');
      skillRegistry.verify(skill.id, 'human');

      const newChiefId = chiefEngine.create(villageId, {
        name: 'SkillChief',
        role: 'executor',
        permissions: ['dispatch_task'],
        skills: [{ skill_id: skill.id, skill_version: 1 }],
      }, 'human').id;

      const ctx = await engine.buildContext(villageId, newChiefId, [], baseCycleState);

      expect(ctx.chief_skills).toHaveLength(1);
      expect(ctx.chief_skills[0].name).toBe('test-skill');
    });

    it('passes intent from cycleState', async () => {
      const intent = {
        goal_kind: 'content_pipeline',
        stage_hint: 'research',
        origin_reason: 'new topic',
        last_decision_summary: 'starting research',
      };

      const ctx = await engine.buildContext(villageId, chiefId, [], {
        ...baseCycleState,
        intent,
      });

      expect(ctx.intent).toEqual(intent);
    });

    it('throws when no active constitution', async () => {
      const constitution = constitutionStore.getActive(villageId)!;
      constitutionStore.revoke(constitution.id, 'human');

      await expect(
        engine.buildContext(villageId, chiefId, [], baseCycleState),
      ).rejects.toThrow('No active constitution');
    });

    it('throws when chief not found', async () => {
      await expect(
        engine.buildContext(villageId, 'nonexistent-chief', [], baseCycleState),
      ).rejects.toThrow('Chief not found');
    });

    it('throws when chief belongs to different village', async () => {
      const villageMgr = new VillageManager(db);
      const v2 = villageMgr.create({ name: 'other', target_repo: 'r' }, 'human');
      constitutionStore.create(v2.id, {
        rules: [{ description: 'basic rule', enforcement: 'soft', scope: ['*'] }],
        allowed_permissions: ['dispatch_task'],
        budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
      }, 'human');

      await expect(
        engine.buildContext(v2.id, chiefId, [], baseCycleState),
      ).rejects.toThrow('Chief does not belong to this village');
    });

    it('graceful degradation without EddaBridge', async () => {
      const ctx = await engine.buildContext(villageId, chiefId, [], baseCycleState);

      expect(ctx.edda_precedents).toEqual([]);
      expect(ctx.edda_available).toBe(false);
    });

    it('tracks loop budget when loop_id provided', async () => {
      riskAssessor.recordSpend(villageId, 'loop-123', 5);

      const ctx = await engine.buildContext(villageId, chiefId, [], {
        ...baseCycleState,
        loop_id: 'loop-123',
      });

      expect(ctx.budget.spent_this_loop).toBe(5);
    });
  });

  // -----------------------------------------------------------------------
  // decide 測試
  // -----------------------------------------------------------------------

  describe('decide', () => {
    it('Phase 0: returns action: null with empty law_proposals', async () => {
      const ctx = await engine.buildContext(villageId, chiefId, [], baseCycleState);
      const result = engine.decide(ctx);

      expect(result.action).toBeNull();
      expect(result.law_proposals).toHaveLength(0);
      expect(result.updated_intent).toBeNull();
    });

    it('reasoning has v0.1 shape (summary, factors, precedent_notes, etc.)', async () => {
      const ctx = await engine.buildContext(villageId, chiefId, [{ some: 'data' }], baseCycleState);
      const result = engine.decide(ctx);

      expect(result.reasoning.summary).toContain('Phase 0');
      expect(result.reasoning.factors.length).toBeGreaterThan(0);
      expect(Array.isArray(result.reasoning.precedent_notes)).toBe(true);
      expect(Array.isArray(result.reasoning.law_considerations)).toBe(true);
      expect(typeof result.reasoning.personality_effect).toBe('string');
      expect(result.reasoning.confidence).toBe(1.0);
    });

    it('reasoning includes constitution factor', async () => {
      const ctx = await engine.buildContext(villageId, chiefId, [], baseCycleState);
      const result = engine.decide(ctx);

      expect(result.reasoning.factors.some(f => f.includes('constitution'))).toBe(true);
    });

    it('reasoning includes observation factor when observations exist', async () => {
      const ctx = await engine.buildContext(villageId, chiefId, [{ event: 'test' }], baseCycleState);
      const result = engine.decide(ctx);

      expect(result.reasoning.factors.some(f => f.includes('1 observation'))).toBe(true);
    });

    it('reasoning includes personality_effect with chief info', async () => {
      const ctx = await engine.buildContext(villageId, chiefId, [], baseCycleState);
      const result = engine.decide(ctx);

      expect(result.reasoning.personality_effect).toContain('TestChief');
      expect(result.reasoning.personality_effect).toContain('governor');
    });

    it('reasoning includes budget factor', async () => {
      const ctx = await engine.buildContext(villageId, chiefId, [], baseCycleState);
      const result = engine.decide(ctx);

      expect(result.reasoning.factors.some(f => f.includes('budget') && f.includes('0%'))).toBe(true);
    });

    it('budget factor shows high usage when > 80%', async () => {
      riskAssessor.recordSpend(villageId, null, 85);

      const ctx = await engine.buildContext(villageId, chiefId, [], baseCycleState);
      const result = engine.decide(ctx);

      expect(result.reasoning.factors.some(f => f.includes('85%'))).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // summarizeOutcome 測試
  // -----------------------------------------------------------------------

  describe('summarizeOutcome', () => {
    it('formats basic outcome', () => {
      const outcome: LoopOutcome = {
        cycle_id: 'cycle-1',
        status: 'completed',
        actions_executed: 3,
        cost_incurred: 15,
      };

      const summary = DecisionEngine.summarizeOutcome(outcome);

      expect(summary).toContain('cycle-1');
      expect(summary).toContain('completed');
      expect(summary).toContain('Actions: 3');
      expect(summary).toContain('Cost: 15');
    });

    it('handles timeout status', () => {
      const outcome: LoopOutcome = {
        cycle_id: 'cycle-3',
        status: 'timeout',
        actions_executed: 0,
        cost_incurred: 0,
      };

      const summary = DecisionEngine.summarizeOutcome(outcome);
      expect(summary).toContain('timeout');
    });
  });

  // -----------------------------------------------------------------------
  // 純查詢驗證 — DecisionEngine 不直接修改 DB
  // -----------------------------------------------------------------------

  describe('purity', () => {
    it('decide does not write to audit_log', async () => {
      const countBefore = (db.prepare('SELECT COUNT(*) as c FROM audit_log').get() as Record<string, number>).c;

      const ctx = await engine.buildContext(villageId, chiefId, [], baseCycleState);
      engine.decide(ctx);

      const countAfter = (db.prepare('SELECT COUNT(*) as c FROM audit_log').get() as Record<string, number>).c;
      expect(countAfter).toBe(countBefore);
    });

    it('buildContext does not write to any table', async () => {
      const tables = ['villages', 'constitutions', 'chiefs', 'laws', 'skills', 'loop_cycles', 'audit_log'];
      const countsBefore: Record<string, number> = {};
      for (const t of tables) {
        countsBefore[t] = (db.prepare(`SELECT COUNT(*) as c FROM ${t}`).get() as Record<string, number>).c;
      }

      await engine.buildContext(villageId, chiefId, [], baseCycleState);

      for (const t of tables) {
        const countAfter = (db.prepare(`SELECT COUNT(*) as c FROM ${t}`).get() as Record<string, number>).c;
        expect(countAfter).toBe(countsBefore[t]);
      }
    });
  });
});
