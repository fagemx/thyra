import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { initSchema, appendAudit } from './db';
import { evaluateVillage } from './village-evaluator';
import { DEFAULT_WEIGHTS, KPI_NAMES } from './schemas/village-score';

function setupDb(): Database {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  initSchema(db);
  return db;
}

function insertVillage(db: Database, id: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO villages (id, name, description, target_repo, status, metadata, version, created_at, updated_at)
     VALUES (?, 'test', '', 'repo', 'active', '{}', 1, ?, ?)`,
  ).run(id, now, now);
}

function insertCycle(
  db: Database,
  villageId: string,
  opts: {
    id?: string;
    status?: string;
    actions?: string;
    cost_incurred?: number;
    budget_remaining?: number;
    created_at?: string;
  } = {},
): string {
  const id = opts.id ?? `cycle-${Math.random().toString(36).slice(2)}`;
  const now = opts.created_at ?? new Date().toISOString();
  db.prepare(
    `INSERT INTO loop_cycles (id, village_id, chief_id, trigger, status, version,
      budget_remaining, cost_incurred, iterations, max_iterations, timeout_ms,
      actions, laws_proposed, laws_enacted, created_at, updated_at)
     VALUES (?, ?, 'chief-1', 'manual', ?, 1, ?, ?, 1, 10, 300000, ?, '[]', '[]', ?, ?)`,
  ).run(
    id,
    villageId,
    opts.status ?? 'completed',
    opts.budget_remaining ?? 50,
    opts.cost_incurred ?? 50,
    opts.actions ?? '[]',
    now,
    now,
  );
  return id;
}

function insertLaw(
  db: Database,
  villageId: string,
  opts: { id?: string; status?: string; created_at?: string } = {},
): string {
  const id = opts.id ?? `law-${Math.random().toString(36).slice(2)}`;
  const now = opts.created_at ?? new Date().toISOString();
  db.prepare(
    `INSERT INTO laws (id, village_id, proposed_by, version, status, category, content,
      risk_level, evidence, created_at, updated_at)
     VALUES (?, ?, 'chief-1', 1, ?, 'test', '{}', 'low', '{}', ?, ?)`,
  ).run(id, villageId, opts.status ?? 'active', now, now);
  return id;
}

const PERIOD = {
  from: '2020-01-01T00:00:00.000Z',
  to: '2030-01-01T00:00:00.000Z',
};

describe('evaluateVillage', () => {
  let db: Database;
  const vid = 'village-test-1';

  beforeEach(() => {
    db = setupDb();
    insertVillage(db, vid);
  });

  // ===== Weight invariants =====

  it('DEFAULT_WEIGHTS sum to 1.0', () => {
    const sum = Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1.0)).toBeLessThan(1e-10);
  });

  it('DEFAULT_WEIGHTS match expected values', () => {
    expect(DEFAULT_WEIGHTS.completion_rate).toBe(0.3);
    expect(DEFAULT_WEIGHTS.review_pass_rate).toBe(0.25);
    expect(DEFAULT_WEIGHTS.rollback_rate).toBe(0.2);
    expect(DEFAULT_WEIGHTS.budget_efficiency).toBe(0.15);
    expect(DEFAULT_WEIGHTS.edda_reuse_rate).toBe(0.1);
  });

  it('KPI_NAMES has 5 entries matching weight keys', () => {
    expect(KPI_NAMES.length).toBe(5);
    for (const name of KPI_NAMES) {
      expect(name in DEFAULT_WEIGHTS).toBe(true);
    }
  });

  // ===== Edge cases — 0 data =====

  it('returns composite_score=0, cycle_count=0 when no cycles', () => {
    const score = evaluateVillage(db, vid, PERIOD);
    expect(score.composite_score).toBe(0);
    expect(score.cycle_count).toBe(0);
    expect(score.village_id).toBe(vid);
  });

  it('returns review_pass_rate=1.0 when no review actions (vacuous truth)', () => {
    insertCycle(db, vid, { actions: '[]' });
    const score = evaluateVillage(db, vid, PERIOD);
    expect(score.kpis.review_pass_rate).toBe(1.0);
  });

  it('returns rollback_rate=0 when no laws exist', () => {
    insertCycle(db, vid);
    const score = evaluateVillage(db, vid, PERIOD);
    expect(score.kpis.rollback_rate).toBe(0);
  });

  // ===== Normal path =====

  it('computes correct completion_rate with mixed statuses', () => {
    insertCycle(db, vid, { status: 'completed' });
    insertCycle(db, vid, { status: 'completed' });
    insertCycle(db, vid, { status: 'aborted' });
    const score = evaluateVillage(db, vid, PERIOD);
    // 2 completed / 3 total
    expect(score.kpis.completion_rate).toBeCloseTo(2 / 3, 5);
    expect(score.cycle_count).toBe(3);
  });

  it('returns all required VillageScore fields', () => {
    insertCycle(db, vid);
    const score = evaluateVillage(db, vid, PERIOD);
    expect(score.village_id).toBe(vid);
    expect(score.period).toEqual(PERIOD);
    expect(score.kpis).toBeDefined();
    expect(score.weights).toBeDefined();
    expect(typeof score.composite_score).toBe('number');
    expect(typeof score.cycle_count).toBe('number');
    expect(typeof score.computed_at).toBe('string');
  });

  it('composite is weighted sum of KPIs', () => {
    // All completed, no reviews, no laws, full budget used
    insertCycle(db, vid, {
      status: 'completed',
      cost_incurred: 100,
      budget_remaining: 0,
    });
    const score = evaluateVillage(db, vid, PERIOD);

    // completion_rate = 1.0
    // review_pass_rate = 1.0 (vacuous)
    // rollback_rate = 0.0 → adjusted = 1.0
    // budget_efficiency = 100 / (100 + 0) = 1.0
    // edda_reuse_rate = 0.0
    // composite = 0.30*1 + 0.25*1 + 0.20*1 + 0.15*1 + 0.10*0 = 0.90
    expect(score.composite_score).toBeCloseTo(0.9, 5);
  });

  // ===== KPI extremes =====

  it('all cycles completed → completion_rate=1.0', () => {
    insertCycle(db, vid, { status: 'completed' });
    insertCycle(db, vid, { status: 'completed' });
    const score = evaluateVillage(db, vid, PERIOD);
    expect(score.kpis.completion_rate).toBe(1.0);
  });

  it('all reviews blocked → review_pass_rate=0.0', () => {
    const actions = JSON.stringify([
      { type: 'code-review', status: 'blocked' },
      { type: 'review', status: 'blocked' },
    ]);
    insertCycle(db, vid, { actions });
    const score = evaluateVillage(db, vid, PERIOD);
    expect(score.kpis.review_pass_rate).toBe(0);
  });

  it('high rollback rate → low rollback contribution', () => {
    // 3 laws, 2 rolled back
    const law1 = insertLaw(db, vid);
    const law2 = insertLaw(db, vid);
    insertLaw(db, vid);

    appendAudit(db, 'law', law1, 'rolled_back', {}, 'human');
    appendAudit(db, 'law', law2, 'rolled_back', {}, 'human');

    insertCycle(db, vid);

    const score = evaluateVillage(db, vid, PERIOD);
    // rollback_rate = 2/3 ≈ 0.667
    expect(score.kpis.rollback_rate).toBeCloseTo(2 / 3, 5);
    // adjusted = 1 - 0.667 = 0.333, contribution = 0.20 * 0.333 ≈ 0.067
  });

  it('budget fully used → budget_efficiency=1.0', () => {
    insertCycle(db, vid, {
      status: 'completed',
      cost_incurred: 100,
      budget_remaining: 0,
    });
    const score = evaluateVillage(db, vid, PERIOD);
    expect(score.kpis.budget_efficiency).toBe(1.0);
  });

  it('edda reuse in every decision → edda_reuse_rate=1.0', () => {
    const cycleId = insertCycle(db, vid);
    // Insert decision audit entries with edda_refs
    appendAudit(db, 'loop', cycleId, 'decision', { edda_refs: ['ref-1'] }, 'chief-1');
    appendAudit(db, 'loop', cycleId, 'decision', { edda_refs: ['ref-2', 'ref-3'] }, 'chief-1');

    const score = evaluateVillage(db, vid, PERIOD);
    expect(score.kpis.edda_reuse_rate).toBe(1.0);
  });

  it('edda reuse partial → correct rate', () => {
    const cycleId = insertCycle(db, vid);
    appendAudit(db, 'loop', cycleId, 'decision', { edda_refs: ['ref-1'] }, 'chief-1');
    appendAudit(db, 'loop', cycleId, 'decision', {}, 'chief-1'); // no edda_refs
    appendAudit(db, 'loop', cycleId, 'decision', { edda_refs: [] }, 'chief-1'); // empty array

    const score = evaluateVillage(db, vid, PERIOD);
    // 1 out of 3 has non-empty edda_refs
    expect(score.kpis.edda_reuse_rate).toBeCloseTo(1 / 3, 5);
  });

  // ===== Budget edge case =====

  it('budget 0/0 → budget_efficiency=0', () => {
    insertCycle(db, vid, {
      status: 'completed',
      cost_incurred: 0,
      budget_remaining: 0,
    });
    const score = evaluateVillage(db, vid, PERIOD);
    expect(score.kpis.budget_efficiency).toBe(0);
  });

  // ===== Audit log recording (caller responsibility) =====

  it('caller can record score to audit_log', () => {
    insertCycle(db, vid);
    const score = evaluateVillage(db, vid, PERIOD);
    appendAudit(db, 'village_score', vid, 'evaluate', score, 'system');

    const row = db
      .prepare(
        `SELECT * FROM audit_log WHERE entity_type = 'village_score' AND entity_id = ?`,
      )
      .get(vid) as Record<string, unknown> | null;
    expect(row).not.toBeNull();
    expect(row!.action).toBe('evaluate');
    const payload = JSON.parse(row!.payload as string);
    expect(payload.composite_score).toBe(score.composite_score);
  });

  // ===== Period filtering =====

  it('respects period boundaries — excludes out-of-range cycles', () => {
    insertCycle(db, vid, {
      status: 'completed',
      created_at: '2025-01-15T00:00:00.000Z',
    });
    insertCycle(db, vid, {
      status: 'aborted',
      created_at: '2025-06-15T00:00:00.000Z',
    });

    const narrowPeriod = {
      from: '2025-01-01T00:00:00.000Z',
      to: '2025-02-01T00:00:00.000Z',
    };
    const score = evaluateVillage(db, vid, narrowPeriod);
    // Only 1 cycle (completed) in range
    expect(score.cycle_count).toBe(1);
    expect(score.kpis.completion_rate).toBe(1.0);
  });
});
