/**
 * monthly-budget.test.ts — 月預算累計 + 自動暫停 + 人類恢復 (#226)
 *
 * 測試覆蓋：
 * 1. Constitution max_cost_per_month schema
 * 2. Chief budget_config + pause/resume
 * 3. RiskAssessor getSpentMonth + per_month check
 * 4. LoopRunner auto-pause after spend
 * 5. Route: POST /api/chiefs/:id/resume
 * 6. THY-09: chief budget_config.max_monthly <= constitution.max_cost_per_month
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { initSchema } from './db';
import { VillageManager } from './village-manager';
import { ConstitutionStore } from './constitution-store';
import { ChiefEngine } from './chief-engine';
import { RiskAssessor } from './risk-assessor';
import { LawEngine } from './law-engine';
import { SkillRegistry } from './skill-registry';
import { LoopRunner } from './loop-runner';
import type { AssessmentContext } from './risk-assessor';

describe('Monthly Budget Accumulation (#226)', () => {
  let db: Database;
  let vm: VillageManager;
  let cs: ConstitutionStore;
  let ce: ChiefEngine;
  let ra: RiskAssessor;
  let sr: SkillRegistry;
  let le: LawEngine;
  let villageId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    initSchema(db);
    vm = new VillageManager(db);
    cs = new ConstitutionStore(db);
    sr = new SkillRegistry(db);
    ce = new ChiefEngine(db, cs, sr);
    ra = new RiskAssessor(db);
    le = new LawEngine(db, cs, ce);

    const village = vm.create({ name: 'Budget Test Village', target_repo: 'test/repo' }, 'test');
    villageId = village.id;
  });

  // =========================================================================
  // 1. Constitution max_cost_per_month schema
  // =========================================================================
  describe('Constitution max_cost_per_month', () => {
    it('defaults to 0 (unlimited) when not specified', () => {
      const c = cs.create(villageId, {
        rules: [{ description: 'test', enforcement: 'hard' }],
        allowed_permissions: ['dispatch_task'],
      }, 'human');
      expect(c.budget_limits.max_cost_per_month).toBe(0);
    });

    it('accepts explicit max_cost_per_month value', () => {
      const c = cs.create(villageId, {
        rules: [{ description: 'test', enforcement: 'hard' }],
        allowed_permissions: ['dispatch_task'],
        budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50, max_cost_per_month: 500 },
      }, 'human');
      expect(c.budget_limits.max_cost_per_month).toBe(500);
    });
  });

  // =========================================================================
  // 2. Chief budget_config + pause/resume
  // =========================================================================
  describe('Chief pause/resume', () => {
    let chiefId: string;

    beforeEach(() => {
      cs.create(villageId, {
        rules: [{ description: 'test', enforcement: 'hard' }],
        allowed_permissions: ['dispatch_task'],
        budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50, max_cost_per_month: 500 },
      }, 'human');

      const chief = ce.create(villageId, {
        name: 'TestChief',
        role: 'tester',
        permissions: ['dispatch_task'],
        budget_config: { max_monthly: 300, budget_reset_day: 1 },
      }, 'human');
      chiefId = chief.id;
    });

    it('creates chief with budget_config', () => {
      const chief = ce.get(chiefId);
      expect(chief).not.toBeNull();
      expect(chief?.budget_config).toEqual({ max_monthly: 300, budget_reset_day: 1 });
      expect(chief?.pause_reason).toBeNull();
      expect(chief?.paused_at).toBeNull();
    });

    it('creates chief with default null budget_config', () => {
      const chief = ce.create(villageId, {
        name: 'NoBudgetChief',
        role: 'tester',
        permissions: ['dispatch_task'],
      }, 'human');
      expect(chief.budget_config).toBeNull();
    });

    it('pauseChief sets status to paused with reason', () => {
      const paused = ce.pauseChief(chiefId, 'MONTHLY_BUDGET_EXCEEDED');
      expect(paused.status).toBe('paused');
      expect(paused.pause_reason).toBe('MONTHLY_BUDGET_EXCEEDED');
      expect(paused.paused_at).toBeTruthy();
    });

    it('pauseChief throws if chief is not active', () => {
      ce.pauseChief(chiefId, 'TEST');
      expect(() => ce.pauseChief(chiefId, 'AGAIN')).toThrow('not active');
    });

    it('resumeChief restores active status', () => {
      ce.pauseChief(chiefId, 'MONTHLY_BUDGET_EXCEEDED');
      const resumed = ce.resumeChief(chiefId, 'human');
      expect(resumed.status).toBe('active');
      expect(resumed.pause_reason).toBeNull();
      expect(resumed.paused_at).toBeNull();
    });

    it('resumeChief throws if chief is not paused', () => {
      expect(() => ce.resumeChief(chiefId, 'human')).toThrow('CHIEF_NOT_PAUSED');
    });

    it('paused chief cannot start loop cycle', () => {
      ce.pauseChief(chiefId, 'MONTHLY_BUDGET_EXCEEDED');
      const lr = new LoopRunner(db, cs, ce, le, ra);
      expect(() => lr.startCycle(villageId, { chief_id: chiefId })).toThrow('inactive');
    });

    it('paused chief is excluded from active list', () => {
      ce.pauseChief(chiefId, 'TEST');
      const activeChiefs = ce.list(villageId, { status: 'active' });
      expect(activeChiefs.find((c) => c.id === chiefId)).toBeUndefined();
    });
  });

  // =========================================================================
  // 3. RiskAssessor getSpentMonth + per_month check
  // =========================================================================
  describe('RiskAssessor monthly budget', () => {
    beforeEach(() => {
      cs.create(villageId, {
        rules: [{ description: 'test', enforcement: 'hard' }],
        allowed_permissions: ['dispatch_task'],
        budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50, max_cost_per_month: 100 },
      }, 'human');
    });

    it('getSpentMonth returns 0 when no spending', () => {
      expect(ra.getSpentMonth(villageId)).toBe(0);
    });

    it('getSpentMonth accumulates recorded spending', () => {
      ra.recordSpend(villageId, null, 20);
      ra.recordSpend(villageId, null, 30);
      expect(ra.getSpentMonth(villageId)).toBe(50);
    });

    it('assess blocks action when monthly budget exceeded', () => {
      // Record enough spending to exceed monthly limit
      ra.recordSpend(villageId, null, 95);

      const constitution = cs.getActive(villageId);
      const ctx: AssessmentContext = {
        constitution,
        recent_rollbacks: [],
      };

      const result = ra.assess({
        type: 'test',
        description: 'test action',
        initiated_by: 'chief-1',
        village_id: villageId,
        estimated_cost: 10,
        reason: 'testing',
        rollback_plan: 'revert',
      }, ctx);

      expect(result.blocked).toBe(true);
      expect(result.budget_check.per_month.ok).toBe(false);
      expect(result.reasons.some((r) => r.id === 'BUDGET-MONTH')).toBe(true);
    });

    it('assess allows action when within monthly budget', () => {
      ra.recordSpend(villageId, null, 50);

      const constitution = cs.getActive(villageId);
      const ctx: AssessmentContext = {
        constitution,
        recent_rollbacks: [],
      };

      const result = ra.assess({
        type: 'test',
        description: 'test action',
        initiated_by: 'chief-1',
        village_id: villageId,
        estimated_cost: 5,
        reason: 'testing',
        rollback_plan: 'revert',
      }, ctx);

      expect(result.budget_check.per_month.ok).toBe(true);
    });

    it('assess uses chief_max_monthly when provided (lower than constitution)', () => {
      const constitution = cs.getActive(villageId);
      const ctx: AssessmentContext = {
        constitution,
        recent_rollbacks: [],
        chief_max_monthly: 50, // lower than constitution's 100
      };

      ra.recordSpend(villageId, null, 45);

      const result = ra.assess({
        type: 'test',
        description: 'test action',
        initiated_by: 'chief-1',
        village_id: villageId,
        estimated_cost: 10,
        reason: 'testing',
        rollback_plan: 'revert',
      }, ctx);

      expect(result.budget_check.per_month.ok).toBe(false);
      expect(result.budget_check.per_month.limit).toBe(50);
    });

    it('unlimited monthly budget (0) does not block', () => {
      const active = cs.getActive(villageId);
      cs.supersede(active!.id, {
        rules: [{ description: 'test', enforcement: 'hard' }],
        allowed_permissions: ['dispatch_task'],
        budget_limits: { max_cost_per_action: 10, max_cost_per_day: 1000, max_cost_per_loop: 500, max_cost_per_month: 0 },
      }, 'human');

      ra.recordSpend(villageId, null, 99999);

      const constitution = cs.getActive(villageId);
      const result = ra.assess({
        type: 'test',
        description: 'test action',
        initiated_by: 'chief-1',
        village_id: villageId,
        estimated_cost: 1,
        reason: 'testing',
        rollback_plan: 'revert',
      }, { constitution, recent_rollbacks: [] });

      expect(result.budget_check.per_month.ok).toBe(true);
    });
  });

  // =========================================================================
  // 4. THY-09: chief budget_config.max_monthly <= constitution.max_cost_per_month
  // =========================================================================
  describe('THY-09: budget_config constraint', () => {
    it('rejects chief max_monthly exceeding constitution', () => {
      cs.create(villageId, {
        rules: [{ description: 'test', enforcement: 'hard' }],
        allowed_permissions: ['dispatch_task'],
        budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50, max_cost_per_month: 200 },
      }, 'human');

      expect(() => ce.create(villageId, {
        name: 'OverBudgetChief',
        role: 'tester',
        permissions: ['dispatch_task'],
        budget_config: { max_monthly: 300, budget_reset_day: 1 },
      }, 'human')).toThrow('BUDGET_EXCEEDS_CONSTITUTION');
    });

    it('allows chief max_monthly equal to constitution', () => {
      cs.create(villageId, {
        rules: [{ description: 'test', enforcement: 'hard' }],
        allowed_permissions: ['dispatch_task'],
        budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50, max_cost_per_month: 200 },
      }, 'human');

      const chief = ce.create(villageId, {
        name: 'EqualBudgetChief',
        role: 'tester',
        permissions: ['dispatch_task'],
        budget_config: { max_monthly: 200, budget_reset_day: 1 },
      }, 'human');

      expect(chief.budget_config?.max_monthly).toBe(200);
    });

    it('allows chief max_monthly when constitution has unlimited (0)', () => {
      cs.create(villageId, {
        rules: [{ description: 'test', enforcement: 'hard' }],
        allowed_permissions: ['dispatch_task'],
        budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50, max_cost_per_month: 0 },
      }, 'human');

      const chief = ce.create(villageId, {
        name: 'AnyBudgetChief',
        role: 'tester',
        permissions: ['dispatch_task'],
        budget_config: { max_monthly: 9999, budget_reset_day: 1 },
      }, 'human');

      expect(chief.budget_config?.max_monthly).toBe(9999);
    });
  });

  // =========================================================================
  // 5. LoopRunner auto-pause after spend
  // =========================================================================
  describe('LoopRunner auto-pause', () => {
    it('pauses chief when monthly budget exceeded after execution', async () => {
      cs.create(villageId, {
        rules: [{ description: 'test', enforcement: 'hard' }],
        allowed_permissions: ['dispatch_task'],
        budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50, max_cost_per_month: 20 },
      }, 'human');

      const chief = ce.create(villageId, {
        name: 'LimitedChief',
        role: 'tester',
        permissions: ['dispatch_task'],
      }, 'human');

      const lr = new LoopRunner(db, cs, ce, le, ra);

      // Pre-record spending close to limit (17 + 3 = 20 <= 20, passes assessment)
      // After execution: total = 20 >= 20, triggers auto-pause
      ra.recordSpend(villageId, null, 17);

      const cycle = lr.startCycle(villageId, { chief_id: chief.id });

      // Execute an action that will push over the limit
      const action = lr.executeAction(cycle.id, {
        action_type: 'test_action',
        description: 'low risk test',
        estimated_cost: 3,
        reason: 'testing auto-pause',
        rollback_plan: 'revert',
      });

      expect(action.status).toBe('executed');

      // Chief should now be paused
      const updatedChief = ce.get(chief.id);
      expect(updatedChief?.status).toBe('paused');
      expect(updatedChief?.pause_reason).toBe('MONTHLY_BUDGET_EXCEEDED');
    });
  });

  // =========================================================================
  // 6. Route: POST /api/chiefs/:id/resume
  // =========================================================================
  describe('Resume route', () => {
    it('resume endpoint exists and is importable', async () => {
      // This test validates the route handler is set up correctly
      // by importing the module — full integration test would use Hono app
      const { chiefRoutes } = await import('./routes/chiefs');
      expect(typeof chiefRoutes).toBe('function');
    });
  });

  // =========================================================================
  // 7. Audit trail
  // =========================================================================
  describe('Audit trail', () => {
    it('pause and resume create audit entries', () => {
      cs.create(villageId, {
        rules: [{ description: 'test', enforcement: 'hard' }],
        allowed_permissions: ['dispatch_task'],
      }, 'human');

      const chief = ce.create(villageId, {
        name: 'AuditChief',
        role: 'tester',
        permissions: ['dispatch_task'],
      }, 'human');

      ce.pauseChief(chief.id, 'MONTHLY_BUDGET_EXCEEDED');
      ce.resumeChief(chief.id, 'human');

      const audits = db.prepare(
        "SELECT * FROM audit_log WHERE entity_type = 'chief' AND entity_id = ? ORDER BY created_at"
      ).all(chief.id) as Array<Record<string, unknown>>;

      const actions = audits.map((a) => a.action);
      expect(actions).toContain('pause');
      expect(actions).toContain('resume');

      // Verify pause audit has reason
      const pauseAudit = audits.find((a) => a.action === 'pause');
      const pausePayload = JSON.parse(pauseAudit?.payload as string);
      expect(pausePayload.reason).toBe('MONTHLY_BUDGET_EXCEEDED');

      // Verify resume audit has actor
      const resumeAudit = audits.find((a) => a.action === 'resume');
      expect(resumeAudit?.actor).toBe('human');
    });
  });
});
