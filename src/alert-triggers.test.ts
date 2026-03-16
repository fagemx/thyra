import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { initSchema, appendAudit } from './db';
import { AlertManager } from './alert-manager';
import { VillageManager } from './village-manager';
import {
  checkBudgetAlert,
  checkChiefTimeoutAlert,
  checkConsecutiveRollbacks,
  checkHealthDrop,
  checkHighRiskAlert,
  checkAnomalyAlert,
} from './alert-triggers';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function setup() {
  const db = new Database(':memory:');
  initSchema(db);
  const vm = new VillageManager(db);
  const am = new AlertManager(db, { dedupWindowMs: 0 }); // No dedup for trigger tests
  const village = vm.create({ name: 'Trigger Test Village', target_repo: 'test/repo' }, 'test');
  return { db, am, village };
}

// ---------------------------------------------------------------------------
// Budget alert tests
// ---------------------------------------------------------------------------

describe('checkBudgetAlert', () => {
  let am: AlertManager;
  let villageId: string;

  beforeEach(() => {
    const s = setup();
    am = s.am;
    villageId = s.village.id;
  });

  it('should not emit below 80%', () => {
    checkBudgetAlert(am, villageId, 0.79, { max_cost_per_day: 100 });
    expect(am.countActive(villageId)).toBe(0);
  });

  it('should emit warning at 80%', () => {
    checkBudgetAlert(am, villageId, 0.80, { max_cost_per_day: 100 });
    const alerts = am.list(villageId);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('warning');
    expect(alerts[0].type).toBe('budget_warning');
  });

  it('should emit critical at 95%', () => {
    checkBudgetAlert(am, villageId, 0.95, { max_cost_per_day: 100 });
    const alerts = am.list(villageId);
    expect(alerts[0].severity).toBe('critical');
  });

  it('should emit emergency at 100%+', () => {
    checkBudgetAlert(am, villageId, 1.05, { max_cost_per_day: 100 });
    const alerts = am.list(villageId);
    expect(alerts[0].severity).toBe('emergency');
  });

  it('should auto-resolve when utilization drops below 70%', () => {
    checkBudgetAlert(am, villageId, 0.85, { max_cost_per_day: 100 });
    expect(am.countActive(villageId)).toBe(1);

    checkBudgetAlert(am, villageId, 0.65, { max_cost_per_day: 100 });
    expect(am.countActive(villageId)).toBe(0);

    const all = am.list(villageId);
    expect(all[0].status).toBe('auto_resolved');
  });

});

// ---------------------------------------------------------------------------
// Chief timeout alert tests
// ---------------------------------------------------------------------------

describe('checkChiefTimeoutAlert', () => {
  let am: AlertManager;
  let villageId: string;

  beforeEach(() => {
    const s = setup();
    am = s.am;
    villageId = s.village.id;
  });

  it('should emit warning on first timeout', () => {
    checkChiefTimeoutAlert(am, {
      chief_id: 'c1', chief_name: 'TestChief', village_id: villageId,
      timeout_count: 1, auto_paused: false,
    });
    const alerts = am.list(villageId);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('warning');
  });

  it('should emit critical on consecutive timeouts', () => {
    checkChiefTimeoutAlert(am, {
      chief_id: 'c1', chief_name: 'TestChief', village_id: villageId,
      timeout_count: 2, auto_paused: false,
    });
    const alerts = am.list(villageId);
    expect(alerts[0].severity).toBe('critical');
  });

  it('should emit emergency on auto-pause', () => {
    checkChiefTimeoutAlert(am, {
      chief_id: 'c1', chief_name: 'TestChief', village_id: villageId,
      timeout_count: 3, auto_paused: true,
    });
    const alerts = am.list(villageId);
    expect(alerts[0].severity).toBe('emergency');
  });
});

// ---------------------------------------------------------------------------
// Consecutive rollbacks tests
// ---------------------------------------------------------------------------

describe('checkConsecutiveRollbacks', () => {
  let db: Database;
  let am: AlertManager;
  let villageId: string;

  beforeEach(() => {
    const s = setup();
    db = s.db;
    am = s.am;
    villageId = s.village.id;
  });

  it('should not emit with fewer than 3 rollbacks', () => {
    appendAudit(db, 'world', villageId, 'rollback', {}, 'system');
    appendAudit(db, 'world', villageId, 'rollback', {}, 'system');
    checkConsecutiveRollbacks(am, db, villageId);
    expect(am.countActive(villageId)).toBe(0);
  });

  it('should emit warning at 3 rollbacks', () => {
    for (let i = 0; i < 3; i++) {
      appendAudit(db, 'world', villageId, 'rollback', {}, 'system');
    }
    checkConsecutiveRollbacks(am, db, villageId);
    const alerts = am.list(villageId);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('warning');
  });

  it('should emit critical at 5 rollbacks', () => {
    for (let i = 0; i < 5; i++) {
      appendAudit(db, 'world', villageId, 'rollback', {}, 'system');
    }
    checkConsecutiveRollbacks(am, db, villageId);
    const alerts = am.list(villageId);
    expect(alerts[0].severity).toBe('critical');
  });
});

// ---------------------------------------------------------------------------
// Health drop tests
// ---------------------------------------------------------------------------

describe('checkHealthDrop', () => {
  let db: Database;
  let am: AlertManager;
  let villageId: string;

  beforeEach(() => {
    const s = setup();
    db = s.db;
    am = s.am;
    villageId = s.village.id;
  });

  it('should not emit on first reading (no previous score)', () => {
    checkHealthDrop(am, db, villageId, 75);
    expect(am.countActive(villageId)).toBe(0);
  });

  it('should update last_health_score in villages table', () => {
    checkHealthDrop(am, db, villageId, 75);
    const row = db.prepare('SELECT last_health_score FROM villages WHERE id = ?')
      .get(villageId) as { last_health_score: number };
    expect(row.last_health_score).toBe(75);
  });

  it('should emit warning on 10-point drop', () => {
    checkHealthDrop(am, db, villageId, 80); // set baseline
    checkHealthDrop(am, db, villageId, 70); // drop 10
    const alerts = am.list(villageId);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('warning');
  });

  it('should emit critical on 20-point drop', () => {
    checkHealthDrop(am, db, villageId, 80);
    checkHealthDrop(am, db, villageId, 60);
    const alerts = am.list(villageId);
    expect(alerts[0].severity).toBe('critical');
  });

  it('should emit emergency when overall below 30', () => {
    checkHealthDrop(am, db, villageId, 25);
    const alerts = am.list(villageId);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('emergency');
  });

  it('should auto-resolve when health recovers', () => {
    checkHealthDrop(am, db, villageId, 80);
    checkHealthDrop(am, db, villageId, 65); // -15 warning
    expect(am.countActive(villageId)).toBe(1);

    checkHealthDrop(am, db, villageId, 70); // recovery (delta < 10)
    expect(am.countActive(villageId)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// High-risk proposal tests
// ---------------------------------------------------------------------------

describe('checkHighRiskAlert', () => {
  let am: AlertManager;
  let villageId: string;

  beforeEach(() => {
    const s = setup();
    am = s.am;
    villageId = s.village.id;
  });

  it('should emit critical alert for high-risk proposal', () => {
    checkHighRiskAlert(am, villageId, {
      change_type: 'constitution.supersede',
      reasons: ['SI-2 violation', 'Budget exceeded'],
      requires_approval: true,
    });
    const alerts = am.list(villageId);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('critical');
    expect(alerts[0].type).toBe('high_risk_proposal');
    expect(alerts[0].details.change_type).toBe('constitution.supersede');
  });
});

// ---------------------------------------------------------------------------
// Anomaly alert tests
// ---------------------------------------------------------------------------

describe('checkAnomalyAlert', () => {
  let am: AlertManager;
  let villageId: string;

  beforeEach(() => {
    const s = setup();
    am = s.am;
    villageId = s.village.id;
  });

  it('should emit warning for low-confidence anomaly', () => {
    checkAnomalyAlert(am, villageId, {
      pattern: 'cost_spike',
      confidence: 0.7,
      description: 'Unusual cost spike detected',
    });
    const alerts = am.list(villageId);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('warning');
    expect(alerts[0].type).toBe('anomaly');
  });

  it('should emit critical for high-confidence anomaly', () => {
    checkAnomalyAlert(am, villageId, {
      pattern: 'cost_spike',
      confidence: 0.95,
      description: 'High confidence cost spike',
    });
    const alerts = am.list(villageId);
    expect(alerts[0].severity).toBe('critical');
  });
});
