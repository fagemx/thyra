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
import type { LoopOutcome, CycleState, DecideContext } from './decision-engine';
import type { LoopAction } from './schemas/loop';
import type { EddaDecisionHit } from './edda-bridge';

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

      expect(result.reasoning.summary.length).toBeGreaterThan(0);
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

  // -----------------------------------------------------------------------
  // Pipeline Rule Engine 測試 (v0.1 Section 9)
  // -----------------------------------------------------------------------

  describe('pipeline rules', () => {
    /** 建立帶有指定 personality 的 chief，回傳 chiefId */
    function createChiefWithPersonality(
      riskTolerance: 'conservative' | 'moderate' | 'aggressive',
      extraOpts?: { constraints?: Array<{ type: 'must' | 'must_not' | 'prefer' | 'avoid'; description: string }> },
    ): string {
      return chiefEngine.create(villageId, {
        name: `${riskTolerance}-chief`,
        role: 'governor',
        permissions: ['dispatch_task', 'propose_law'],
        personality: {
          risk_tolerance: riskTolerance,
          communication_style: 'concise',
          decision_speed: 'deliberate',
        },
        constraints: extraOpts?.constraints ?? [],
      }, 'human').id;
    }

    /** 建立並驗證一個 skill */
    function createVerifiedSkill(name: string): string {
      const skill = skillRegistry.create({
        name,
        definition: {
          description: `${name} skill`,
          prompt_template: `Do ${name}`,
          tools_required: [],
          constraints: [],
        },
      }, 'human');
      skillRegistry.verify(skill.id, 'human');
      return skill.id;
    }

    /** 快速建立一個帶有特定條件的 DecideContext */
    async function buildTestContext(overrides: Partial<CycleState> & {
      observations?: Record<string, unknown>[];
      useChiefId?: string;
    } = {}): Promise<DecideContext> {
      const cId = overrides.useChiefId ?? chiefId;
      return engine.buildContext(
        villageId,
        cId,
        overrides.observations ?? [],
        {
          ...baseCycleState,
          ...overrides,
        },
      );
    }

    // Test 1: 無 active law、無 intent → action: null
    it('no active law, no intent → action: null (cycle completed)', async () => {
      const ctx = await buildTestContext();
      const result = engine.decide(ctx);

      expect(result.action).toBeNull();
      expect(result.reasoning.summary).toContain('No action needed');
    });

    // Test 2: 有 active law、無 intent → 開始新流水線
    it('has active law, no intent → start new pipeline (dispatch_task research)', async () => {
      // 建立 verified research skill
      createVerifiedSkill('research');

      // 給 chief enact_law_low 權限讓 law 自動生效
      chiefEngine.update(chiefId, {
        permissions: ['dispatch_task', 'propose_law', 'enact_law_low'],
      }, 'human');

      // 建立 active law
      lawEngine.propose(villageId, chiefId, {
        category: 'testing',
        content: { description: 'test law', strategy: {} },
        evidence: { source: 'test', reasoning: 'testing' },
      });

      const ctx = await buildTestContext();
      expect(ctx.active_laws.length).toBeGreaterThan(0);

      const result = engine.decide(ctx);

      expect(result.action).not.toBeNull();
      expect(result.action!.kind).toBe('dispatch_task');
      expect(result.action!.task_key).toBe('research');
    });

    // Test 3: intent stage=research + last_action=executed → 進 draft
    it('intent stage=research + last_action=executed → advance to draft', async () => {
      createVerifiedSkill('draft');

      const actions: LoopAction[] = [
        { type: 'research', description: 'r', estimated_cost: 5, risk_level: 'low', status: 'executed', reason: 'ok' },
      ];

      const ctx = await buildTestContext({
        actions,
        intent: {
          goal_kind: 'content_pipeline',
          stage_hint: 'research',
          origin_reason: 'test',
          last_decision_summary: 'started research',
        },
      });

      const result = engine.decide(ctx);

      expect(result.action).not.toBeNull();
      expect(result.action!.kind).toBe('dispatch_task');
      expect(result.action!.task_key).toBe('draft');
    });

    // Test 4: pending_approval 存在 → wait
    it('pending_approval exists → wait', async () => {
      const actions: LoopAction[] = [
        { type: 'review', description: 'rv', estimated_cost: 2, risk_level: 'medium', status: 'pending_approval', reason: 'needs human' },
      ];

      const ctx = await buildTestContext({ actions });
      const result = engine.decide(ctx);

      expect(result.action).not.toBeNull();
      expect(result.action!.kind).toBe('wait');
    });

    // Test 5: budget_ratio < 0.1 → complete_cycle
    it('budget_ratio < 0.1 → complete_cycle', async () => {
      // 花掉 95% 的預算
      riskAssessor.recordSpend(villageId, null, 95);

      const ctx = await buildTestContext();
      const result = engine.decide(ctx);

      expect(result.action).not.toBeNull();
      expect(result.action!.kind).toBe('complete_cycle');
      expect(result.action!.reason).toContain('Budget exhausted');
    });

    // Test 6: conservative chief + 負面判例 → lower confidence
    it('conservative chief + negative precedent → lower confidence', async () => {
      createVerifiedSkill('research');

      const conservativeChiefId = createChiefWithPersonality('conservative');

      // 給 chief enact_law_low 權限
      chiefEngine.update(conservativeChiefId, {
        permissions: ['dispatch_task', 'propose_law', 'enact_law_low'],
      }, 'human');

      // 建立 active law
      lawEngine.propose(villageId, conservativeChiefId, {
        category: 'testing',
        content: { description: 'test law', strategy: {} },
        evidence: { source: 'test', reasoning: 'testing' },
      });

      // 建立有 active law 的 context，然後手動注入 edda precedent
      const ctx = await buildTestContext({ useChiefId: conservativeChiefId });

      // 手動注入負面判例
      const ctxWithPrecedent: DecideContext = {
        ...ctx,
        edda_precedents: [{
          event_id: 'evt-neg-1',
          key: 'test.strategy',
          value: 'harmful — caused failures',
          reason: 'negative outcome',
          domain: 'test',
          branch: 'main',
          ts: new Date().toISOString(),
          is_active: true,
        }],
        edda_available: true,
      };

      const result = engine.decide(ctxWithPrecedent);

      // conservative + negative precedent → confidence should be lowered
      expect(result.reasoning.confidence).toBeLessThan(0.5);
    });

    // Test 7: aggressive chief + 正面判例 → raise confidence
    it('aggressive chief + positive precedent → raise confidence', async () => {
      createVerifiedSkill('research');

      const aggressiveChiefId = createChiefWithPersonality('aggressive');

      // 給 chief enact_law_low 權限
      chiefEngine.update(aggressiveChiefId, {
        permissions: ['dispatch_task', 'propose_law', 'enact_law_low'],
      }, 'human');

      // 建立 active law
      lawEngine.propose(villageId, aggressiveChiefId, {
        category: 'testing',
        content: { description: 'test law', strategy: {} },
        evidence: { source: 'test', reasoning: 'testing' },
      });

      const ctx = await buildTestContext({ useChiefId: aggressiveChiefId });

      // 手動注入正面判例
      const ctxWithPrecedent: DecideContext = {
        ...ctx,
        edda_precedents: [{
          event_id: 'evt-pos-1',
          key: 'test.strategy',
          value: 'effective — good results',
          reason: 'positive outcome',
          domain: 'test',
          branch: 'main',
          ts: new Date().toISOString(),
          is_active: true,
        }],
        edda_available: true,
      };

      const result = engine.decide(ctxWithPrecedent);

      // aggressive + positive precedent → confidence should be high
      expect(result.reasoning.confidence).toBeGreaterThan(0.8);
    });

    // Test 8: 連續 3 次 blocked → law proposal
    it('3 consecutive blocks + rollbacks → law proposal', async () => {
      const actions: LoopAction[] = [
        { type: 'a1', description: 'd1', estimated_cost: 5, risk_level: 'high', status: 'blocked', reason: 'SI', blocked_reasons: ['SI-1'] },
        { type: 'a2', description: 'd2', estimated_cost: 5, risk_level: 'high', status: 'blocked', reason: 'SI', blocked_reasons: ['SI-2'] },
        { type: 'a3', description: 'd3', estimated_cost: 5, risk_level: 'high', status: 'blocked', reason: 'SI', blocked_reasons: ['SI-3'] },
      ];

      const ctx = await buildTestContext({ actions });
      const result = engine.decide(ctx);

      expect(result.law_proposals.length).toBeGreaterThan(0);
      expect(result.law_proposals[0].evidence.source).toBe('decision_engine');
    });

    // Test 9: task_key 無對應 verified skill → 不產出該候選
    it('task_key has no verified skill → filtered out', async () => {
      // 不建立任何 skill，但有 active law + no intent → 嘗試 research
      chiefEngine.update(chiefId, {
        permissions: ['dispatch_task', 'propose_law', 'enact_law_low'],
      }, 'human');

      lawEngine.propose(villageId, chiefId, {
        category: 'testing',
        content: { description: 'test law', strategy: {} },
        evidence: { source: 'test', reasoning: 'testing' },
      });

      const ctx = await buildTestContext();
      expect(ctx.active_laws.length).toBeGreaterThan(0);

      const result = engine.decide(ctx);

      // No verified 'research' skill → candidates filtered → action null
      expect(result.action).toBeNull();
    });

    // Test 10: Edda offline → 正常運作
    it('Edda offline → normal operation (edda_available=false)', async () => {
      const ctx = await buildTestContext();

      expect(ctx.edda_available).toBe(false);
      expect(ctx.edda_precedents).toEqual([]);

      const result = engine.decide(ctx);

      // 仍然可以正常運作（無 law 無 intent → null action）
      expect(result.reasoning.summary.length).toBeGreaterThan(0);
    });

    // Test 11: 全 blocked → complete_cycle
    it('all blocked (>= 3) → complete_cycle', async () => {
      const actions: LoopAction[] = [
        { type: 'a1', description: 'd1', estimated_cost: 5, risk_level: 'high', status: 'blocked', reason: 'SI', blocked_reasons: ['SI-1'] },
        { type: 'a2', description: 'd2', estimated_cost: 5, risk_level: 'high', status: 'blocked', reason: 'SI', blocked_reasons: ['SI-2'] },
        { type: 'a3', description: 'd3', estimated_cost: 5, risk_level: 'high', status: 'blocked', reason: 'SI', blocked_reasons: ['SI-3'] },
      ];

      const ctx = await buildTestContext({ actions });
      const result = engine.decide(ctx);

      expect(result.action).not.toBeNull();
      expect(result.action!.kind).toBe('complete_cycle');
      expect(result.action!.reason).toContain('blocked');
    });

    // Test 12: reasoning 完整 → SI-2 滿足
    it('reasoning complete → SI-2 satisfied (summary non-empty)', async () => {
      const ctx = await buildTestContext();
      const result = engine.decide(ctx);

      expect(result.reasoning.summary).toBeTruthy();
      expect(result.reasoning.summary.length).toBeGreaterThan(0);
      expect(Array.isArray(result.reasoning.factors)).toBe(true);
      expect(result.reasoning.factors.length).toBeGreaterThan(0);
      expect(typeof result.reasoning.personality_effect).toBe('string');
      expect(result.reasoning.personality_effect.length).toBeGreaterThan(0);
    });

    // Extra: harmful law still active → propose revoke
    it('law with harmful effectiveness still active → propose revoke', async () => {
      chiefEngine.update(chiefId, {
        permissions: ['dispatch_task', 'propose_law', 'enact_law_low'],
      }, 'human');

      const law = lawEngine.propose(villageId, chiefId, {
        category: 'testing',
        content: { description: 'harmful test law', strategy: {} },
        evidence: { source: 'test', reasoning: 'testing' },
      });

      // 評估為 harmful（非 auto-approved 的 law 不會 auto-rollback）
      // 需要手動 approve 先
      if (law.status === 'proposed') {
        lawEngine.approve(law.id, 'human');
      }

      lawEngine.evaluate(law.id, {
        metrics: { quality: -5 },
        verdict: 'harmful',
      });

      // law 可能已被 auto-rollback（如果 auto-approved），先確認 active
      const activeLaws = lawEngine.getActiveLaws(villageId);
      if (activeLaws.some(l => l.effectiveness?.verdict === 'harmful')) {
        const ctx = await buildTestContext();
        const result = engine.decide(ctx);

        expect(result.law_proposals.length).toBeGreaterThan(0);
        expect(result.law_proposals.some(p => p.content.description.includes('Revoke harmful'))).toBe(true);
      }
    });

    // Extra: pipeline advances through review → publish
    it('intent stage=review + last_action=executed → advance to publish', async () => {
      createVerifiedSkill('publish');

      const actions: LoopAction[] = [
        { type: 'review', description: 'rv', estimated_cost: 2, risk_level: 'low', status: 'executed', reason: 'ok' },
      ];

      const ctx = await buildTestContext({
        actions,
        intent: {
          goal_kind: 'content_pipeline',
          stage_hint: 'review',
          origin_reason: 'test',
          last_decision_summary: 'review done',
        },
      });

      const result = engine.decide(ctx);

      expect(result.action).not.toBeNull();
      expect(result.action!.kind).toBe('dispatch_task');
      expect(result.action!.task_key).toBe('publish');
    });

    // Extra: publish completed → complete_cycle
    it('intent stage=publish + last_action=executed → complete_cycle', async () => {
      const actions: LoopAction[] = [
        { type: 'publish', description: 'pub', estimated_cost: 2, risk_level: 'low', status: 'executed', reason: 'ok' },
      ];

      const ctx = await buildTestContext({
        actions,
        intent: {
          goal_kind: 'content_pipeline',
          stage_hint: 'publish',
          origin_reason: 'test',
          last_decision_summary: 'publish done',
        },
      });

      const result = engine.decide(ctx);

      expect(result.action).not.toBeNull();
      expect(result.action!.kind).toBe('complete_cycle');
      expect(result.action!.reason).toContain('Pipeline completed');
    });

    // Extra: updated_intent is set when advancing pipeline
    it('updated_intent is set when dispatching task', async () => {
      createVerifiedSkill('draft');

      const actions: LoopAction[] = [
        { type: 'research', description: 'r', estimated_cost: 5, risk_level: 'low', status: 'executed', reason: 'ok' },
      ];

      const ctx = await buildTestContext({
        actions,
        intent: {
          goal_kind: 'content_pipeline',
          stage_hint: 'research',
          origin_reason: 'test',
          last_decision_summary: 'research done',
        },
      });

      const result = engine.decide(ctx);

      expect(result.updated_intent).not.toBeNull();
      expect(result.updated_intent!.stage_hint).toBe('draft');
      expect(result.updated_intent!.goal_kind).toBe('content_pipeline');
    });
  });
});
