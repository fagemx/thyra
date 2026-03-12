import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { createDb, initSchema } from './db';
import { VillageManager } from './village-manager';
import { ConstitutionStore } from './constitution-store';
import { RiskAssessor, SAFETY_INVARIANTS } from './risk-assessor';
import type { Action, AssessmentContext } from './risk-assessor';

function makeAction(overrides: Partial<Action> = {}): Action {
  return {
    type: 'propose_law',
    description: 'Test action',
    initiated_by: 'chief-1',
    village_id: 'village-1',
    estimated_cost: 1,
    reason: 'testing',
    rollback_plan: 'revert',
    ...overrides,
  };
}

describe('RiskAssessor', () => {
  let db: Database;
  let assessor: RiskAssessor;
  let constitutionStore: ConstitutionStore;
  let villageId: string;
  let ctx: AssessmentContext;

  beforeEach(() => {
    db = createDb(':memory:');
    initSchema(db);
    assessor = new RiskAssessor(db);
    constitutionStore = new ConstitutionStore(db);
    villageId = new VillageManager(db).create({ name: 't', target_repo: 'r' }, 'u').id;
    const constitution = constitutionStore.create(villageId, {
      rules: [{ description: 'must review', enforcement: 'hard', scope: ['*'] }],
      allowed_permissions: ['dispatch_task', 'propose_law'],
      budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
    }, 'h');
    ctx = { constitution, recent_rollbacks: [] };
  });

  it('has exactly 7 safety invariants', () => {
    expect(SAFETY_INVARIANTS).toHaveLength(7);
  });

  it('SI-1: disable_human_override → blocked', () => {
    const result = assessor.assess(makeAction({ type: 'disable_human_override', village_id: villageId }), ctx);
    expect(result.blocked).toBe(true);
    expect(result.reasons.some((r) => r.id === 'SI-1')).toBe(true);
  });

  it('SI-2: no reason → blocked', () => {
    const result = assessor.assess(makeAction({ reason: '', village_id: villageId }), ctx);
    expect(result.blocked).toBe(true);
    expect(result.reasons.some((r) => r.id === 'SI-2')).toBe(true);
  });

  it('SI-3: no rollback_plan → blocked', () => {
    const action = makeAction({ village_id: villageId });
    delete action.rollback_plan;
    const result = assessor.assess(action, ctx);
    expect(result.blocked).toBe(true);
    expect(result.reasons.some((r) => r.id === 'SI-3')).toBe(true);
  });

  it('SI-4: cost over per_action limit → blocked', () => {
    const result = assessor.assess(makeAction({ estimated_cost: 20, village_id: villageId }), ctx);
    expect(result.blocked).toBe(true);
    expect(result.reasons.some((r) => r.id === 'SI-4')).toBe(true);
  });

  it('SI-5: grants unauthorized permission → blocked', () => {
    const result = assessor.assess(makeAction({ grants_permission: ['deploy'], village_id: villageId }), ctx);
    expect(result.blocked).toBe(true);
    expect(result.reasons.some((r) => r.id === 'SI-5')).toBe(true);
  });

  it('SI-6: delete_constitution → blocked', () => {
    const result = assessor.assess(makeAction({ type: 'delete_constitution', village_id: villageId }), ctx);
    expect(result.blocked).toBe(true);
    expect(result.reasons.some((r) => r.id === 'SI-6')).toBe(true);
  });

  it('SI-7: cross_village without both allowing → blocked', () => {
    const result = assessor.assess(makeAction({ cross_village: true, village_id: villageId }), ctx);
    expect(result.blocked).toBe(true);
    expect(result.reasons.some((r) => r.id === 'SI-7')).toBe(true);
  });

  it('low risk action → level low', () => {
    const result = assessor.assess(makeAction({ village_id: villageId }), ctx);
    expect(result.level).toBe('low');
    expect(result.blocked).toBe(false);
  });

  it('deploy action → level medium+', () => {
    const result = assessor.assess(makeAction({ type: 'deploy', village_id: villageId }), ctx);
    expect(result.level).not.toBe('low');
  });

  it('cross village with both_constitutions_allow → not blocked by SI-7', () => {
    const result = assessor.assess(
      makeAction({ cross_village: true, village_id: villageId }),
      { ...ctx, both_constitutions_allow: true },
    );
    expect(result.reasons.some((r) => r.id === 'SI-7')).toBe(false);
    // But H-2 heuristic still triggers
    expect(result.level).toBe('high');
  });

  it('recent rollback → level high', () => {
    const result = assessor.assess(
      makeAction({ village_id: villageId }),
      { ...ctx, recent_rollbacks: [{ category: 'review', rolled_back_at: new Date().toISOString() }] },
    );
    expect(result.level).toBe('high');
  });

  it('aggressive chief → medium', () => {
    const result = assessor.assess(
      makeAction({ village_id: villageId }),
      { ...ctx, chief_personality: { risk_tolerance: 'aggressive', communication_style: 'concise', decision_speed: 'fast' } },
    );
    expect(result.level).toBe('medium');
  });

  it('budget tracking: recordSpend → getSpentToday', () => {
    assessor.recordSpend(villageId, null, 5);
    expect(assessor.getSpentToday(villageId)).toBe(5);
    assessor.recordSpend(villageId, null, 3);
    expect(assessor.getSpentToday(villageId)).toBe(8);
  });

  it('budget tracking: per_day check accumulates', () => {
    assessor.recordSpend(villageId, null, 90);
    const result = assessor.assess(makeAction({ estimated_cost: 5, village_id: villageId }), ctx);
    expect(result.budget_check.per_day.ok).toBe(true);
    assessor.recordSpend(villageId, null, 10);
    const result2 = assessor.assess(makeAction({ estimated_cost: 5, village_id: villageId }), ctx);
    expect(result2.budget_check.per_day.ok).toBe(false);
  });

  it('budget tracking: per_loop check', () => {
    assessor.recordSpend(villageId, 'loop-1', 45);
    const result = assessor.assess(
      makeAction({ estimated_cost: 8, village_id: villageId }),
      { ...ctx, loop_id: 'loop-1' },
    );
    expect(result.budget_check.per_loop.ok).toBe(false);
  });

  it('per_day overrun → blocked with BUDGET-DAY reason', () => {
    assessor.recordSpend(villageId, null, 96);
    const result = assessor.assess(makeAction({ estimated_cost: 5, village_id: villageId }), ctx);
    expect(result.blocked).toBe(true);
    expect(result.level).toBe('high');
    expect(result.reasons.some((r) => r.id === 'BUDGET-DAY' && r.severity === 'block')).toBe(true);
  });

  it('per_loop overrun → blocked with BUDGET-LOOP reason', () => {
    assessor.recordSpend(villageId, 'loop-1', 45);
    const result = assessor.assess(
      makeAction({ estimated_cost: 8, village_id: villageId }),
      { ...ctx, loop_id: 'loop-1' },
    );
    expect(result.blocked).toBe(true);
    expect(result.level).toBe('high');
    expect(result.reasons.some((r) => r.id === 'BUDGET-LOOP' && r.severity === 'block')).toBe(true);
  });

  it('both per_day and per_loop exceeded → both reasons present', () => {
    assessor.recordSpend(villageId, 'loop-1', 96);
    const result = assessor.assess(
      makeAction({ estimated_cost: 5, village_id: villageId }),
      { ...ctx, loop_id: 'loop-1' },
    );
    expect(result.blocked).toBe(true);
    expect(result.reasons.some((r) => r.id === 'BUDGET-DAY')).toBe(true);
    expect(result.reasons.some((r) => r.id === 'BUDGET-LOOP')).toBe(true);
  });

  it('exactly at budget limit → not blocked', () => {
    // per_day: limit=100, spent=95, cost=5 → 95+5=100 ≤ 100 → ok
    assessor.recordSpend(villageId, 'loop-1', 45);
    const result = assessor.assess(
      makeAction({ estimated_cost: 5, village_id: villageId }),
      { ...ctx, loop_id: 'loop-1' },
    );
    // per_loop: limit=50, spent=45, cost=5 → 45+5=50 ≤ 50 → ok
    expect(result.budget_check.per_day.ok).toBe(true);
    expect(result.budget_check.per_loop.ok).toBe(true);
    expect(result.blocked).toBe(false);
  });

  describe('Layer 2: Constitution Rules', () => {
    it('hard rule violation blocks action', () => {
      const v2Id = new VillageManager(db).create({ name: 'v2', target_repo: 'r2' }, 'u').id;
      const constitution = constitutionStore.create(v2Id, {
        rules: [{ id: 'R-NO-DEPLOY', description: 'must not auto-deploy', enforcement: 'hard', scope: ['*'] }],
        allowed_permissions: ['dispatch_task'],
        budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
      }, 'h');
      // Action that triggers violation: rule says "must not auto-deploy", action does "auto-deploy"
      const result = assessor.assess(
        makeAction({ type: 'auto-deploy', description: 'auto-deploy to production', village_id: v2Id }),
        { constitution, recent_rollbacks: [] },
      );
      expect(result.blocked).toBe(true);
      expect(result.level).toBe('high');
      expect(result.reasons.some((r) => r.source === 'constitution' && r.id === 'R-NO-DEPLOY' && r.severity === 'block')).toBe(true);
    });

    it('soft rule violation raises level to medium, not blocked', () => {
      const v3Id = new VillageManager(db).create({ name: 'v3', target_repo: 'r3' }, 'u').id;
      const constitution = constitutionStore.create(v3Id, {
        rules: [{ id: 'R-NO-SKIP', description: 'must not skip testing', enforcement: 'soft', scope: ['*'] }],
        allowed_permissions: ['dispatch_task'],
        budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
      }, 'h');
      // Action violates: rule says "must not skip testing", action does "skip testing"
      const result = assessor.assess(
        makeAction({ type: 'skip_testing', description: 'skip testing for hotfix', village_id: v3Id }),
        { constitution, recent_rollbacks: [] },
      );
      expect(result.blocked).toBe(false);
      expect(result.reasons.some((r) => r.source === 'constitution' && r.severity === 'medium')).toBe(true);
      expect(result.level).toBe('medium');
    });

    it('out-of-scope rule ignored', () => {
      const v4Id = new VillageManager(db).create({ name: 'v4', target_repo: 'r4' }, 'u').id;
      const constitution = constitutionStore.create(v4Id, {
        rules: [{ id: 'R-SCOPED', description: 'must not auto-deploy', enforcement: 'hard', scope: ['chief-2'] }],
        allowed_permissions: ['dispatch_task'],
        budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
      }, 'h');
      // chief-1 is not in scope ['chief-2'], so rule should not apply
      const result = assessor.assess(
        makeAction({ type: 'auto-deploy', description: 'auto-deploy service', initiated_by: 'chief-1', village_id: v4Id }),
        { constitution, recent_rollbacks: [] },
      );
      expect(result.reasons.filter((r) => r.source === 'constitution')).toHaveLength(0);
    });

    it('no constitution → Layer 2 skipped, level low', () => {
      const result = assessor.assess(
        makeAction({ village_id: villageId }),
        { constitution: null, recent_rollbacks: [] },
      );
      expect(result.blocked).toBe(false);
      expect(result.level).toBe('low');
      expect(result.reasons.filter((r) => r.source === 'constitution')).toHaveLength(0);
    });

    it('multiple rules: hard + soft → hard blocks regardless', () => {
      const v5Id = new VillageManager(db).create({ name: 'v5', target_repo: 'r5' }, 'u').id;
      const constitution = constitutionStore.create(v5Id, {
        rules: [
          { id: 'R-HARD', description: 'never auto-deploy', enforcement: 'hard', scope: ['*'] },
          { id: 'R-SOFT', description: 'not auto-deploy without approval', enforcement: 'soft', scope: ['*'] },
        ],
        allowed_permissions: ['dispatch_task'],
        budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
      }, 'h');
      const result = assessor.assess(
        makeAction({ type: 'auto-deploy', description: 'auto-deploy service', village_id: v5Id }),
        { constitution, recent_rollbacks: [] },
      );
      expect(result.blocked).toBe(true);
      expect(result.level).toBe('high');
      expect(result.reasons.some((r) => r.id === 'R-HARD' && r.severity === 'block')).toBe(true);
      expect(result.reasons.some((r) => r.id === 'R-SOFT' && r.severity === 'medium')).toBe(true);
    });
  });
});
