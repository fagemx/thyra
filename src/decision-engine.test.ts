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
import type { LoopOutcome } from './decision-engine';

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
    it('assembles complete context', async () => {
      const ctx = await engine.buildContext(villageId, chiefId, [], {
        iteration: 0,
        max_iterations: 10,
      });

      expect(ctx.village_id).toBe(villageId);
      expect(ctx.chief.id).toBe(chiefId);
      expect(ctx.chief.name).toBe('TestChief');
      expect(ctx.constitution.status).toBe('active');
      expect(ctx.active_laws).toHaveLength(0);
      expect(ctx.chief_skills).toHaveLength(0);
      expect(ctx.precedents).toHaveLength(0);
      expect(ctx.cycle_iteration).toBe(0);
      expect(ctx.max_iterations).toBe(10);
    });

    it('includes budget snapshot from constitution', async () => {
      const ctx = await engine.buildContext(villageId, chiefId, [], {
        iteration: 0,
        max_iterations: 10,
      });

      expect(ctx.budget.per_action_limit).toBe(10);
      expect(ctx.budget.per_day_limit).toBe(100);
      expect(ctx.budget.per_loop_limit).toBe(50);
      expect(ctx.budget.spent_today).toBe(0);
      expect(ctx.budget.spent_this_loop).toBe(0);
    });

    it('includes observations in context', async () => {
      const obs = [{ type: 'test', data: 'value' }];
      const ctx = await engine.buildContext(villageId, chiefId, obs, {
        iteration: 3,
        max_iterations: 10,
      });

      expect(ctx.observations).toHaveLength(1);
      expect(ctx.observations[0]).toEqual({ type: 'test', data: 'value' });
      expect(ctx.cycle_iteration).toBe(3);
    });

    it('includes active laws in context', async () => {
      // 建立一個 auto-approved law
      const chief = chiefEngine.get(chiefId)!;
      // Update chief with enact_law_low permission
      chiefEngine.update(chiefId, {
        permissions: ['dispatch_task', 'propose_law', 'enact_law_low'],
      }, 'human');

      lawEngine.propose(villageId, chiefId, {
        category: 'testing',
        content: { description: 'test law', strategy: {} },
        evidence: { source: 'unit-test', reasoning: 'testing' },
      });

      const ctx = await engine.buildContext(villageId, chiefId, [], {
        iteration: 0,
        max_iterations: 10,
      });

      expect(ctx.active_laws.length).toBeGreaterThanOrEqual(1);
    });

    it('includes chief skills when bound', async () => {
      // 建立並驗證 skill
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

      // 重建 chief with skill binding
      const newChiefId = chiefEngine.create(villageId, {
        name: 'SkillChief',
        role: 'executor',
        permissions: ['dispatch_task'],
        skills: [{ skill_id: skill.id, skill_version: 1 }],
      }, 'human').id;

      const ctx = await engine.buildContext(villageId, newChiefId, [], {
        iteration: 0,
        max_iterations: 10,
      });

      expect(ctx.chief_skills).toHaveLength(1);
      expect(ctx.chief_skills[0].name).toBe('test-skill');
    });

    it('throws when no active constitution', async () => {
      // Revoke the constitution
      const constitution = constitutionStore.getActive(villageId)!;
      constitutionStore.revoke(constitution.id, 'human');

      await expect(
        engine.buildContext(villageId, chiefId, [], { iteration: 0, max_iterations: 10 }),
      ).rejects.toThrow('No active constitution');
    });

    it('throws when chief not found', async () => {
      await expect(
        engine.buildContext(villageId, 'nonexistent-chief', [], { iteration: 0, max_iterations: 10 }),
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
        engine.buildContext(v2.id, chiefId, [], { iteration: 0, max_iterations: 10 }),
      ).rejects.toThrow('Chief does not belong to this village');
    });

    it('graceful degradation without EddaBridge (precedents = [])', async () => {
      const ctx = await engine.buildContext(villageId, chiefId, [], {
        iteration: 0,
        max_iterations: 10,
      });

      expect(ctx.precedents).toEqual([]);
    });

    it('tracks loop budget when loop_id provided', async () => {
      // Record some spend
      riskAssessor.recordSpend(villageId, 'loop-123', 5);

      const ctx = await engine.buildContext(villageId, chiefId, [], {
        iteration: 1,
        max_iterations: 10,
        loop_id: 'loop-123',
      });

      expect(ctx.budget.spent_this_loop).toBe(5);
    });
  });

  // -----------------------------------------------------------------------
  // decide 測試
  // -----------------------------------------------------------------------

  describe('decide', () => {
    it('Phase 0: always returns action: null', async () => {
      const ctx = await engine.buildContext(villageId, chiefId, [], {
        iteration: 0,
        max_iterations: 10,
      });

      const result = engine.decide(ctx);

      expect(result.action).toBeNull();
    });

    it('returns reasoning with factors and conclusion', async () => {
      const ctx = await engine.buildContext(villageId, chiefId, [{ some: 'data' }], {
        iteration: 0,
        max_iterations: 10,
      });

      const result = engine.decide(ctx);

      expect(result.reasoning.factors.length).toBeGreaterThan(0);
      expect(result.reasoning.conclusion).toContain('Phase 0');
      expect(result.reasoning.confidence).toBe(1.0);
    });

    it('reasoning includes constitution factor', async () => {
      const ctx = await engine.buildContext(villageId, chiefId, [], {
        iteration: 0,
        max_iterations: 10,
      });

      const result = engine.decide(ctx);
      const constitutionFactor = result.reasoning.factors.find(f => f.source === 'constitution');

      expect(constitutionFactor).toBeDefined();
      expect(constitutionFactor!.weight).toBe('high');
    });

    it('reasoning includes observation factor when observations exist', async () => {
      const ctx = await engine.buildContext(villageId, chiefId, [{ event: 'test' }], {
        iteration: 0,
        max_iterations: 10,
      });

      const result = engine.decide(ctx);
      const obsFactor = result.reasoning.factors.find(f => f.source === 'observation');

      expect(obsFactor).toBeDefined();
      expect(obsFactor!.description).toContain('1 observation');
    });

    it('reasoning includes chief constraint factors', async () => {
      const ctx = await engine.buildContext(villageId, chiefId, [], {
        iteration: 0,
        max_iterations: 10,
      });

      const result = engine.decide(ctx);
      const constraintFactors = result.reasoning.factors.filter(f => f.source === 'chief_constraint');

      // Chief has 2 constraints: must + avoid
      expect(constraintFactors).toHaveLength(2);
      expect(constraintFactors.find(f => f.description.includes('must'))).toBeDefined();
    });

    it('reasoning includes budget factor', async () => {
      const ctx = await engine.buildContext(villageId, chiefId, [], {
        iteration: 0,
        max_iterations: 10,
      });

      const result = engine.decide(ctx);
      const budgetFactor = result.reasoning.factors.find(f => f.source === 'budget');

      expect(budgetFactor).toBeDefined();
      expect(budgetFactor!.description).toContain('0%');
    });

    it('budget factor weight is high when budget > 80% used', async () => {
      // Spend 85% of daily budget
      riskAssessor.recordSpend(villageId, null, 85);

      const ctx = await engine.buildContext(villageId, chiefId, [], {
        iteration: 0,
        max_iterations: 10,
      });

      const result = engine.decide(ctx);
      const budgetFactor = result.reasoning.factors.find(f => f.source === 'budget');

      expect(budgetFactor!.weight).toBe('high');
    });

    it('cycle_intent.should_continue = false in Phase 0', async () => {
      const ctx = await engine.buildContext(villageId, chiefId, [], {
        iteration: 0,
        max_iterations: 10,
      });

      const result = engine.decide(ctx);

      expect(result.cycle_intent.should_continue).toBe(false);
      expect(result.cycle_intent.reason).toContain('Phase 0');
    });
  });

  // -----------------------------------------------------------------------
  // summarizeOutcome 測試
  // -----------------------------------------------------------------------

  describe('summarizeOutcome', () => {
    it('formats basic outcome', () => {
      const outcome: LoopOutcome = {
        cycle_id: 'cycle-1',
        village_id: 'village-1',
        total_actions: 3,
        total_cost: 15,
        laws_proposed: [],
        laws_enacted: [],
        final_status: 'completed',
        reasoning_summary: 'All tasks completed normally',
      };

      const summary = DecisionEngine.summarizeOutcome(outcome);

      expect(summary).toContain('cycle-1');
      expect(summary).toContain('completed');
      expect(summary).toContain('Actions: 3');
      expect(summary).toContain('Cost: 15');
      expect(summary).toContain('All tasks completed normally');
    });

    it('includes laws when present', () => {
      const outcome: LoopOutcome = {
        cycle_id: 'cycle-2',
        village_id: 'village-1',
        total_actions: 1,
        total_cost: 5,
        laws_proposed: ['law-1', 'law-2'],
        laws_enacted: ['law-1'],
        final_status: 'completed',
        reasoning_summary: '',
      };

      const summary = DecisionEngine.summarizeOutcome(outcome);

      expect(summary).toContain('Laws proposed: law-1, law-2');
      expect(summary).toContain('Laws enacted: law-1');
    });

    it('handles timeout status', () => {
      const outcome: LoopOutcome = {
        cycle_id: 'cycle-3',
        village_id: 'village-1',
        total_actions: 0,
        total_cost: 0,
        laws_proposed: [],
        laws_enacted: [],
        final_status: 'timeout',
        reasoning_summary: 'Timed out',
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

      const ctx = await engine.buildContext(villageId, chiefId, [], {
        iteration: 0,
        max_iterations: 10,
      });
      engine.decide(ctx);

      const countAfter = (db.prepare('SELECT COUNT(*) as c FROM audit_log').get() as Record<string, number>).c;

      // buildContext queries but doesn't write; decide is pure computation
      // The count should not have changed after decide()
      expect(countAfter).toBe(countBefore);
    });

    it('buildContext does not write to any table', async () => {
      // Capture counts before
      const tables = ['villages', 'constitutions', 'chiefs', 'laws', 'skills', 'loop_cycles', 'audit_log'];
      const countsBefore: Record<string, number> = {};
      for (const t of tables) {
        countsBefore[t] = (db.prepare(`SELECT COUNT(*) as c FROM ${t}`).get() as Record<string, number>).c;
      }

      await engine.buildContext(villageId, chiefId, [], {
        iteration: 0,
        max_iterations: 10,
      });

      // Verify no writes
      for (const t of tables) {
        const countAfter = (db.prepare(`SELECT COUNT(*) as c FROM ${t}`).get() as Record<string, number>).c;
        expect(countAfter).toBe(countsBefore[t]);
      }
    });
  });
});
