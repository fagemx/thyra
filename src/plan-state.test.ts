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
import type { DecideContext } from './decision-engine';
import type { LoopAction, PlanState, CycleIntent } from './schemas/loop';
import {
  PlanStateSchema,
  PlannedStepSchema,
  CompletedStepSchema,
  CycleIntentSchema,
} from './schemas/loop';
import { createMockLlmAdvisor } from './llm-advisor';

// ---------------------------------------------------------------------------
// 測試用 helper
// ---------------------------------------------------------------------------

function makePlan(overrides?: Partial<PlanState>): PlanState {
  return PlanStateSchema.parse({
    version: 'v1',
    objective: 'Write a blog post about AI governance',
    planned_steps: [
      { task_key: 'research', estimated_cost: 2, reason: 'Research the topic', status: 'pending' },
      { task_key: 'draft', estimated_cost: 3, reason: 'Write the draft', depends_on: ['research'], status: 'pending' },
      { task_key: 'review', estimated_cost: 1, reason: 'Review the draft', depends_on: ['draft'], status: 'pending' },
    ],
    completed_steps: [],
    fallback: 'replan',
    success_criteria: 'Blog post published and reviewed',
    stop_criteria: 'Budget exhausted or 3 consecutive failures',
    ...overrides,
  });
}

function makeIntentWithPlan(plan: PlanState, overrides?: Partial<CycleIntent>): CycleIntent {
  return CycleIntentSchema.parse({
    goal_kind: 'plan_execution',
    stage_hint: 'research',
    origin_reason: 'Blog pipeline started',
    last_decision_summary: 'Plan created',
    plan,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Zod Schema 驗證測試
// ---------------------------------------------------------------------------

describe('PlanState Zod Schemas', () => {
  describe('PlannedStepSchema', () => {
    it('validates a minimal planned step', () => {
      const result = PlannedStepSchema.safeParse({
        task_key: 'research',
        estimated_cost: 2.5,
        reason: 'Research AI governance',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe('pending'); // default
        expect(result.data.depends_on).toBeUndefined();
      }
    });

    it('validates a step with dependencies and status', () => {
      const result = PlannedStepSchema.safeParse({
        task_key: 'draft',
        estimated_cost: 3,
        reason: 'Write draft',
        depends_on: ['research'],
        status: 'blocked',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.depends_on).toEqual(['research']);
        expect(result.data.status).toBe('blocked');
      }
    });

    it('rejects empty task_key', () => {
      const result = PlannedStepSchema.safeParse({
        task_key: '',
        estimated_cost: 1,
        reason: 'test',
      });
      expect(result.success).toBe(false);
    });

    it('rejects negative cost', () => {
      const result = PlannedStepSchema.safeParse({
        task_key: 'research',
        estimated_cost: -1,
        reason: 'test',
      });
      expect(result.success).toBe(false);
    });

    it('accepts all valid statuses', () => {
      for (const status of ['pending', 'in_progress', 'blocked', 'skipped']) {
        const result = PlannedStepSchema.safeParse({
          task_key: 'test',
          estimated_cost: 1,
          reason: 'test',
          status,
        });
        expect(result.success).toBe(true);
      }
    });
  });

  describe('CompletedStepSchema', () => {
    it('validates a completed step', () => {
      const result = CompletedStepSchema.safeParse({
        task_key: 'research',
        estimated_cost: 2,
        reason: 'Research done',
        status: 'pending',
        actual_cost: 1.8,
        result: 'Found 5 relevant papers',
        completed_at: '2026-03-15T10:00:00Z',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.actual_cost).toBe(1.8);
        expect(result.data.result).toBe('Found 5 relevant papers');
      }
    });

    it('rejects missing actual_cost', () => {
      const result = CompletedStepSchema.safeParse({
        task_key: 'research',
        estimated_cost: 2,
        reason: 'test',
        result: 'done',
        completed_at: '2026-03-15T10:00:00Z',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('PlanStateSchema', () => {
    it('validates a full plan', () => {
      const plan = makePlan();
      expect(plan.version).toBe('v1');
      expect(plan.planned_steps).toHaveLength(3);
      expect(plan.completed_steps).toHaveLength(0);
      expect(plan.fallback).toBe('replan');
    });

    it('applies defaults for version, fallback, completed_steps', () => {
      const result = PlanStateSchema.safeParse({
        objective: 'Test objective',
        planned_steps: [
          { task_key: 'step1', estimated_cost: 1, reason: 'do it' },
        ],
        success_criteria: 'success',
        stop_criteria: 'stop',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.version).toBe('v1');
        expect(result.data.fallback).toBe('replan');
        expect(result.data.completed_steps).toEqual([]);
      }
    });

    it('rejects empty planned_steps', () => {
      const result = PlanStateSchema.safeParse({
        objective: 'Test',
        planned_steps: [],
        success_criteria: 'done',
        stop_criteria: 'stop',
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing objective', () => {
      const result = PlanStateSchema.safeParse({
        planned_steps: [{ task_key: 's', estimated_cost: 1, reason: 'r' }],
        success_criteria: 'done',
        stop_criteria: 'stop',
      });
      expect(result.success).toBe(false);
    });

    it('accepts all fallback strategies', () => {
      for (const fallback of ['retry', 'skip', 'replan', 'abort']) {
        const result = PlanStateSchema.safeParse({
          objective: 'Test',
          planned_steps: [{ task_key: 's', estimated_cost: 1, reason: 'r' }],
          success_criteria: 'done',
          stop_criteria: 'stop',
          fallback,
        });
        expect(result.success).toBe(true);
      }
    });
  });

  describe('CycleIntentSchema backward compatibility', () => {
    it('parses legacy intent without plan', () => {
      const result = CycleIntentSchema.safeParse({
        goal_kind: 'content_pipeline',
        stage_hint: 'research',
        origin_reason: 'started',
        last_decision_summary: 'began',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.plan).toBeUndefined();
      }
    });

    it('parses intent with plan', () => {
      const plan = makePlan();
      const result = CycleIntentSchema.safeParse({
        goal_kind: 'plan_execution',
        stage_hint: 'research',
        origin_reason: 'plan started',
        last_decision_summary: 'plan created',
        plan,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.plan).toBeDefined();
        expect(result.data.plan!.planned_steps).toHaveLength(3);
      }
    });

    it('roundtrips through JSON (DB storage)', () => {
      const plan = makePlan();
      const intent = makeIntentWithPlan(plan);
      const json = JSON.stringify(intent);
      const parsed = CycleIntentSchema.parse(JSON.parse(json));
      expect(parsed.plan?.objective).toBe(plan.objective);
      expect(parsed.plan?.planned_steps).toHaveLength(3);
    });
  });
});

// ---------------------------------------------------------------------------
// Plan-based Decision Flow 測試
// ---------------------------------------------------------------------------

describe('DecisionEngine plan-based flow', () => {
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
    villageId = villageMgr.create({ name: 'plan-village', target_repo: 'fagemx/plan' }, 'human').id;

    constitutionStore = new ConstitutionStore(db);
    constitutionStore.create(villageId, {
      rules: [
        { description: 'review required', enforcement: 'soft', scope: ['*'] },
      ],
      allowed_permissions: ['dispatch_task', 'propose_law', 'enact_law_low'],
      budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
    }, 'human');

    skillRegistry = new SkillRegistry(db);
    // 註冊 research, draft, review, evaluate skills
    for (const skillName of ['research', 'draft', 'review', 'evaluate']) {
      const skill = skillRegistry.create({
        name: skillName,
        village_id: villageId,
        definition: {
          description: `${skillName} skill`,
          prompt_template: `Execute ${skillName}`,
        },
      }, 'human');
      // 驗證 skill（THY-14）
      if (skill.status !== 'verified') {
        skillRegistry.verify(skill.id, 'human');
      }
    }

    chiefEngine = new ChiefEngine(db, constitutionStore, skillRegistry);
    lawEngine = new LawEngine(db, constitutionStore, chiefEngine);
    riskAssessor = new RiskAssessor(db);

    chiefId = chiefEngine.create(villageId, {
      name: 'PlanChief',
      role: 'governor',
      permissions: ['dispatch_task', 'propose_law'],
      constraints: [],
    }, 'human').id;

    engine = new DecisionEngine(
      db, constitutionStore, chiefEngine, lawEngine,
      skillRegistry, riskAssessor, null,
    );
  });

  // -----------------------------------------------------------------------
  // 基本 plan-based flow
  // -----------------------------------------------------------------------

  it('dispatches first pending step of a plan', async () => {
    const plan = makePlan();
    const intent = makeIntentWithPlan(plan);

    const ctx = await engine.buildContext(villageId, chiefId, [], {
      cycle_id: 'cycle-plan-1',
      iteration: 0,
      max_iterations: 10,
      intent,
    });

    const result = await engine.decide(ctx);
    expect(result.action).not.toBeNull();
    expect(result.action!.kind).toBe('dispatch_task');
    expect(result.action!.task_key).toBe('research');
    expect(result.updated_intent?.plan).toBeDefined();
  });

  it('skips steps with unmet dependencies', async () => {
    // draft depends on research, research is still pending
    const plan = makePlan({
      planned_steps: [
        { task_key: 'draft', estimated_cost: 3, reason: 'Write draft', depends_on: ['research'], status: 'pending' },
        { task_key: 'review', estimated_cost: 1, reason: 'Review', depends_on: ['draft'], status: 'pending' },
      ],
    });
    const intent = makeIntentWithPlan(plan);

    const ctx = await engine.buildContext(villageId, chiefId, [], {
      cycle_id: 'cycle-plan-dep',
      iteration: 0,
      max_iterations: 10,
      intent,
    });

    // 所有 pending 步驟都有未滿足的依賴 → 應觸發 plan repair 或 complete
    const result = await engine.decide(ctx);
    expect(result.action).not.toBeNull();
    // 沒有 LlmAdvisor，且 fallback=replan → 應 complete_cycle
    expect(result.action!.kind).toBe('complete_cycle');
    expect(result.reasoning.factors.some(f => f.includes('unmet dependencies'))).toBe(true);
  });

  it('completes cycle when all steps are done', async () => {
    const plan = makePlan({
      planned_steps: [
        { task_key: 'research', estimated_cost: 2, reason: 'done', status: 'skipped' },
        { task_key: 'draft', estimated_cost: 3, reason: 'done', status: 'skipped' },
        { task_key: 'review', estimated_cost: 1, reason: 'done', status: 'skipped' },
      ],
    });
    const intent = makeIntentWithPlan(plan);

    const ctx = await engine.buildContext(villageId, chiefId, [], {
      cycle_id: 'cycle-plan-done',
      iteration: 5,
      max_iterations: 10,
      intent,
    });

    const result = await engine.decide(ctx);
    expect(result.action).not.toBeNull();
    expect(result.action!.kind).toBe('complete_cycle');
    expect(result.action!.reason).toContain('Plan completed');
  });

  it('respects dependency chain: dispatches step whose deps are completed', async () => {
    const plan = makePlan({
      planned_steps: [
        { task_key: 'research', estimated_cost: 2, reason: 'research', status: 'skipped' },
        { task_key: 'draft', estimated_cost: 3, reason: 'Write draft', depends_on: ['research'], status: 'pending' },
        { task_key: 'review', estimated_cost: 1, reason: 'Review', depends_on: ['draft'], status: 'pending' },
      ],
      completed_steps: [
        {
          task_key: 'research', estimated_cost: 2, reason: 'done',
          actual_cost: 1.5, result: 'Found papers', completed_at: '2026-03-15T10:00:00Z',
          status: 'pending',
        },
      ],
    });
    const intent = makeIntentWithPlan(plan);

    const ctx = await engine.buildContext(villageId, chiefId, [], {
      cycle_id: 'cycle-plan-chain',
      iteration: 2,
      max_iterations: 10,
      intent,
    });

    const result = await engine.decide(ctx);
    expect(result.action).not.toBeNull();
    expect(result.action!.kind).toBe('dispatch_task');
    expect(result.action!.task_key).toBe('draft');
  });

  // -----------------------------------------------------------------------
  // Plan repair 測試
  // -----------------------------------------------------------------------

  it('triggers plan repair when step is blocked (with LlmAdvisor)', async () => {
    const repairedPlan = makePlan({
      planned_steps: [
        { task_key: 'evaluate', estimated_cost: 1, reason: 'Evaluate alternatives', status: 'pending' },
        { task_key: 'draft', estimated_cost: 3, reason: 'Write revised draft', status: 'pending' },
      ],
    });

    const mockAdvisor = createMockLlmAdvisor({
      repairPlanResult: repairedPlan,
    });

    const engineWithLlm = new DecisionEngine(
      db, constitutionStore, chiefEngine, lawEngine,
      skillRegistry, riskAssessor, null, mockAdvisor,
    );

    const plan = makePlan();
    const intent = makeIntentWithPlan(plan);

    // 上一個 action 被 blocked
    const blockedAction: LoopAction = {
      type: 'research',
      description: 'Research blocked',
      estimated_cost: 2,
      risk_level: 'low',
      status: 'blocked',
      reason: 'Skill unavailable',
      blocked_reasons: ['External API down'],
    };

    const ctx = await engineWithLlm.buildContext(villageId, chiefId, [], {
      cycle_id: 'cycle-plan-repair',
      iteration: 1,
      max_iterations: 10,
      actions: [blockedAction],
      intent,
    });

    const result = await engineWithLlm.decide(ctx);
    expect(result.action).not.toBeNull();
    expect(result.action!.kind).toBe('dispatch_task');
    expect(result.action!.task_key).toBe('evaluate');
    expect(result.updated_intent?.plan).toBeDefined();
    expect(result.updated_intent!.plan!.planned_steps).toHaveLength(2);
    expect(result.reasoning.factors.some(f => f.includes('repaired'))).toBe(true);
  });

  it('completes cycle when plan repair is unavailable (no LlmAdvisor)', async () => {
    const plan = makePlan();
    const intent = makeIntentWithPlan(plan);

    const blockedAction: LoopAction = {
      type: 'research',
      description: 'blocked',
      estimated_cost: 2,
      risk_level: 'low',
      status: 'blocked',
      reason: 'blocked',
      blocked_reasons: ['Skill unavailable'],
    };

    const ctx = await engine.buildContext(villageId, chiefId, [], {
      cycle_id: 'cycle-no-repair',
      iteration: 1,
      max_iterations: 10,
      actions: [blockedAction],
      intent,
    });

    const result = await engine.decide(ctx);
    expect(result.action).not.toBeNull();
    expect(result.action!.kind).toBe('complete_cycle');
    expect(result.action!.reason).toContain('stuck');
  });

  // -----------------------------------------------------------------------
  // Fallback 策略測試
  // -----------------------------------------------------------------------

  it('fallback=abort completes cycle immediately on block', async () => {
    const plan = makePlan({ fallback: 'abort' });
    const intent = makeIntentWithPlan(plan);

    const blockedAction: LoopAction = {
      type: 'research',
      description: 'blocked',
      estimated_cost: 2,
      risk_level: 'low',
      status: 'blocked',
      reason: 'blocked',
      blocked_reasons: ['Error'],
    };

    const ctx = await engine.buildContext(villageId, chiefId, [], {
      cycle_id: 'cycle-abort',
      iteration: 1,
      max_iterations: 10,
      actions: [blockedAction],
      intent,
    });

    const result = await engine.decide(ctx);
    expect(result.action!.kind).toBe('complete_cycle');
    expect(result.action!.reason).toContain('aborted');
    expect(result.reasoning.factors.some(f => f.includes('abort'))).toBe(true);
  });

  it('fallback=skip skips the blocked step and continues', async () => {
    const plan = makePlan({
      fallback: 'skip',
      planned_steps: [
        { task_key: 'research', estimated_cost: 2, reason: 'Research', status: 'pending' },
        { task_key: 'draft', estimated_cost: 3, reason: 'Draft', status: 'pending' },
      ],
    });
    const intent = makeIntentWithPlan(plan);

    const blockedAction: LoopAction = {
      type: 'research',
      description: 'blocked',
      estimated_cost: 2,
      risk_level: 'low',
      status: 'blocked',
      reason: 'blocked',
      blocked_reasons: ['Error'],
    };

    const ctx = await engine.buildContext(villageId, chiefId, [], {
      cycle_id: 'cycle-skip',
      iteration: 1,
      max_iterations: 10,
      actions: [blockedAction],
      intent,
    });

    const result = await engine.decide(ctx);
    expect(result.action).not.toBeNull();
    expect(result.action!.kind).toBe('dispatch_task');
    expect(result.action!.task_key).toBe('draft');
    // research should be skipped in updated plan
    const updatedPlan = result.updated_intent?.plan;
    expect(updatedPlan).toBeDefined();
    expect(updatedPlan!.planned_steps.find(s => s.task_key === 'research')?.status).toBe('skipped');
  });

  // -----------------------------------------------------------------------
  // 向後相容測試
  // -----------------------------------------------------------------------

  it('legacy intent (no plan) uses original pipeline flow', async () => {
    const legacyIntent: CycleIntent = {
      goal_kind: 'content_pipeline',
      stage_hint: 'research',
      origin_reason: 'started',
      last_decision_summary: 'began',
    };

    const lastAction: LoopAction = {
      type: 'research',
      description: 'done',
      estimated_cost: 2,
      risk_level: 'low',
      status: 'executed',
      reason: 'done',
    };

    const ctx = await engine.buildContext(villageId, chiefId, [], {
      cycle_id: 'cycle-legacy',
      iteration: 2,
      max_iterations: 10,
      actions: [lastAction],
      intent: legacyIntent,
    });

    const result = await engine.decide(ctx);
    // Legacy flow should advance pipeline: research → draft
    expect(result.action).not.toBeNull();
    expect(result.action!.kind).toBe('dispatch_task');
    expect(result.action!.task_key).toBe('draft');
  });

  it('null intent uses original pipeline flow', async () => {
    // 有 active laws → 應啟動 pipeline
    chiefEngine.update(chiefId, {
      permissions: ['dispatch_task', 'propose_law', 'enact_law_low'],
    }, 'human');
    lawEngine.propose(villageId, chiefId, {
      category: 'content',
      content: { description: 'Create blog posts', strategy: {} },
      evidence: { source: 'test', reasoning: 'testing' },
    });

    const ctx = await engine.buildContext(villageId, chiefId, [], {
      cycle_id: 'cycle-null-intent',
      iteration: 0,
      max_iterations: 10,
      intent: null,
    });

    const result = await engine.decide(ctx);
    // 有 active laws 但 intent=null → startPipeline → research
    expect(result.action).not.toBeNull();
    expect(result.action!.kind).toBe('dispatch_task');
    expect(result.action!.task_key).toBe('research');
  });

  // -----------------------------------------------------------------------
  // Plan repair 確定性過濾測試
  // -----------------------------------------------------------------------

  it('plan repair validates steps against SkillRegistry', async () => {
    // repaired plan 包含一個不存在的 skill
    const repairedPlan = makePlan({
      planned_steps: [
        { task_key: 'nonexistent_skill', estimated_cost: 1, reason: 'Does not exist', status: 'pending' },
        { task_key: 'draft', estimated_cost: 3, reason: 'Write draft', status: 'pending' },
      ],
    });

    const mockAdvisor = createMockLlmAdvisor({
      repairPlanResult: repairedPlan,
    });

    const engineWithLlm = new DecisionEngine(
      db, constitutionStore, chiefEngine, lawEngine,
      skillRegistry, riskAssessor, null, mockAdvisor,
    );

    const plan = makePlan();
    const intent = makeIntentWithPlan(plan);

    const blockedAction: LoopAction = {
      type: 'research',
      description: 'blocked',
      estimated_cost: 2,
      risk_level: 'low',
      status: 'blocked',
      reason: 'blocked',
      blocked_reasons: ['API down'],
    };

    const ctx = await engineWithLlm.buildContext(villageId, chiefId, [], {
      cycle_id: 'cycle-validate-repair',
      iteration: 1,
      max_iterations: 10,
      actions: [blockedAction],
      intent,
    });

    const result = await engineWithLlm.decide(ctx);
    expect(result.action).not.toBeNull();
    // nonexistent_skill should be skipped, draft should be dispatched
    expect(result.action!.task_key).toBe('draft');
    const updatedPlan = result.updated_intent?.plan;
    expect(updatedPlan!.planned_steps.find(s => s.task_key === 'nonexistent_skill')?.status).toBe('skipped');
  });

  it('plan repair validates steps against budget', async () => {
    const repairedPlan = makePlan({
      planned_steps: [
        { task_key: 'research', estimated_cost: 999, reason: 'Way over budget', status: 'pending' },
        { task_key: 'draft', estimated_cost: 3, reason: 'Write draft', status: 'pending' },
      ],
    });

    const mockAdvisor = createMockLlmAdvisor({
      repairPlanResult: repairedPlan,
    });

    const engineWithLlm = new DecisionEngine(
      db, constitutionStore, chiefEngine, lawEngine,
      skillRegistry, riskAssessor, null, mockAdvisor,
    );

    const plan = makePlan();
    const intent = makeIntentWithPlan(plan);

    const blockedAction: LoopAction = {
      type: 'research',
      description: 'blocked',
      estimated_cost: 2,
      risk_level: 'low',
      status: 'blocked',
      reason: 'blocked',
      blocked_reasons: ['Error'],
    };

    const ctx = await engineWithLlm.buildContext(villageId, chiefId, [], {
      cycle_id: 'cycle-budget-repair',
      iteration: 1,
      max_iterations: 10,
      actions: [blockedAction],
      intent,
    });

    const result = await engineWithLlm.decide(ctx);
    expect(result.action).not.toBeNull();
    // 999 cost step should be skipped, draft dispatched
    expect(result.action!.task_key).toBe('draft');
  });

  // -----------------------------------------------------------------------
  // updated_intent 持久化測試
  // -----------------------------------------------------------------------

  it('updated_intent contains plan in plan-based flow', async () => {
    const plan = makePlan();
    const intent = makeIntentWithPlan(plan);

    const ctx = await engine.buildContext(villageId, chiefId, [], {
      cycle_id: 'cycle-intent-plan',
      iteration: 0,
      max_iterations: 10,
      intent,
    });

    const result = await engine.decide(ctx);
    expect(result.updated_intent).not.toBeNull();
    expect(result.updated_intent!.plan).toBeDefined();
    expect(result.updated_intent!.plan!.objective).toBe(plan.objective);
    expect(result.updated_intent!.goal_kind).toBe('plan_execution');
  });

  // -----------------------------------------------------------------------
  // Edda 整合 hook 測試（via context fixture）
  // -----------------------------------------------------------------------

  it('plan-based flow includes edda precedents in evidence_refs', async () => {
    const plan = makePlan();
    const intent = makeIntentWithPlan(plan);

    // 直接構建含 edda_precedents 的 context（不需要 EddaBridge 實例）
    const ctx = await engine.buildContext(villageId, chiefId, [], {
      cycle_id: 'cycle-edda-plan',
      iteration: 0,
      max_iterations: 10,
      intent,
    });

    // 注入 edda precedent 到 context
    const ctxWithEdda: DecideContext = {
      ...ctx,
      edda_precedents: [
        {
          event_id: 'edda-1',
          key: 'plan.research',
          value: 'effective: research approach worked well',
          reason: 'Previous plan succeeded',
          domain: 'plan',
          branch: 'main',
          ts: new Date().toISOString(),
          is_active: true,
        },
      ],
      edda_available: true,
    };

    const result = await engine.decide(ctxWithEdda);
    expect(result.action).not.toBeNull();
    expect(result.action!.evidence_refs).toContain('edda-1');
  });

  // -----------------------------------------------------------------------
  // 步驟無 skill 時觸發 repair
  // -----------------------------------------------------------------------

  it('triggers repair when planned step has no matching skill', async () => {
    const plan = makePlan({
      planned_steps: [
        { task_key: 'unknown_step', estimated_cost: 2, reason: 'No skill for this', status: 'pending' },
      ],
    });
    const intent = makeIntentWithPlan(plan);

    const ctx = await engine.buildContext(villageId, chiefId, [], {
      cycle_id: 'cycle-no-skill',
      iteration: 0,
      max_iterations: 10,
      intent,
    });

    const result = await engine.decide(ctx);
    // 沒有 LlmAdvisor → complete_cycle
    expect(result.action!.kind).toBe('complete_cycle');
    expect(result.reasoning.factors.some(f => f.includes('No skill found'))).toBe(true);
  });
});
