import type { Database } from 'bun:sqlite';
import { DEFAULT_WEIGHTS, KPI_NAMES } from './schemas/village-score';
import type { VillageScore, VillageKpis, KpiName } from './schemas/village-score';

/**
 * 計算 village 的 cycle 完成率
 * completed / total cycles in period
 */
function computeCompletionRate(
  db: Database,
  villageId: string,
  from: string,
  to: string,
): number {
  const row = db
    .prepare(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
       FROM loop_cycles
       WHERE village_id = ? AND created_at >= ? AND created_at <= ?`,
    )
    .get(villageId, from, to) as { total: number; completed: number } | null;

  if (!row || row.total === 0) return 0;
  return row.completed / row.total;
}

/**
 * 計算 review 通過率
 * Parse loop_cycles.actions JSON, count actions with type containing 'review'
 * where status = 'executed' vs total review actions.
 * If no review actions → 1.0 (vacuous truth)
 */
function computeReviewPassRate(
  db: Database,
  villageId: string,
  from: string,
  to: string,
): number {
  const rows = db
    .prepare(
      `SELECT actions FROM loop_cycles
       WHERE village_id = ? AND created_at >= ? AND created_at <= ?`,
    )
    .all(villageId, from, to) as { actions: string }[];

  let totalReviews = 0;
  let passedReviews = 0;

  for (const row of rows) {
    const actions = JSON.parse(row.actions || '[]') as Array<{
      type?: string;
      status?: string;
    }>;
    for (const action of actions) {
      if (action.type && action.type.includes('review')) {
        totalReviews++;
        if (action.status === 'executed') {
          passedReviews++;
        }
      }
    }
  }

  if (totalReviews === 0) return 1.0; // vacuous truth
  return passedReviews / totalReviews;
}

/**
 * 計算 law rollback 率
 * rollback entries in audit_log / total laws for village in period
 * 0 laws → 0.0
 */
function computeRollbackRate(
  db: Database,
  villageId: string,
  from: string,
  to: string,
): number {
  const lawCount = db
    .prepare(
      `SELECT COUNT(*) as cnt FROM laws
       WHERE village_id = ? AND created_at >= ? AND created_at <= ?`,
    )
    .get(villageId, from, to) as { cnt: number } | null;

  if (!lawCount || lawCount.cnt === 0) return 0;

  const rollbackCount = db
    .prepare(
      `SELECT COUNT(*) as cnt FROM audit_log
       WHERE entity_type = 'law'
         AND action = 'rollback'
         AND entity_id IN (SELECT id FROM laws WHERE village_id = ?)
         AND created_at >= ? AND created_at <= ?`,
    )
    .get(villageId, from, to) as { cnt: number } | null;

  return (rollbackCount?.cnt ?? 0) / lawCount.cnt;
}

/**
 * 計算預算使用效率
 * AVG(cost_incurred / (cost_incurred + budget_remaining)) for completed cycles
 * If no completed cycles or all budgets 0 → 0.0
 */
function computeBudgetEfficiency(
  db: Database,
  villageId: string,
  from: string,
  to: string,
): number {
  const rows = db
    .prepare(
      `SELECT cost_incurred, budget_remaining FROM loop_cycles
       WHERE village_id = ? AND status = 'completed'
         AND created_at >= ? AND created_at <= ?`,
    )
    .all(villageId, from, to) as Array<{
    cost_incurred: number;
    budget_remaining: number;
  }>;

  if (rows.length === 0) return 0;

  let sum = 0;
  let count = 0;
  for (const row of rows) {
    const total = row.cost_incurred + row.budget_remaining;
    if (total > 0) {
      sum += row.cost_incurred / total;
      count++;
    }
  }

  return count === 0 ? 0 : sum / count;
}

/**
 * 計算 Edda 判例引用率
 * audit_log entries with action='decision' that have non-empty edda_refs in payload
 * / total decision entries for this village
 * If no decisions → 0.0
 */
function computeEddaReuseRate(
  db: Database,
  villageId: string,
  from: string,
  to: string,
): number {
  const rows = db
    .prepare(
      `SELECT payload FROM audit_log
       WHERE entity_type = 'loop'
         AND action = 'decision'
         AND entity_id IN (SELECT id FROM loop_cycles WHERE village_id = ?)
         AND created_at >= ? AND created_at <= ?`,
    )
    .all(villageId, from, to) as Array<{ payload: string }>;

  if (rows.length === 0) return 0;

  let withEdda = 0;
  for (const row of rows) {
    try {
      const payload = JSON.parse(row.payload);
      if (
        payload.edda_refs &&
        Array.isArray(payload.edda_refs) &&
        payload.edda_refs.length > 0
      ) {
        withEdda++;
      }
    } catch {
      // malformed payload — skip
    }
  }

  return withEdda / rows.length;
}

/**
 * 計算加權合成分數
 * rollback_rate 是反向指標：score = 1 - rollback_rate
 */
function computeComposite(
  kpis: VillageKpis,
  weights: Record<KpiName, number>,
): number {
  let score = 0;
  for (const name of KPI_NAMES) {
    const raw = kpis[name];
    // rollback_rate is inverse: lower rollback = higher score
    const adjusted = name === 'rollback_rate' ? 1 - raw : raw;
    score += weights[name] * adjusted;
  }
  // Clamp to [0, 1] to handle floating point edge cases
  return Math.max(0, Math.min(1, score));
}

/**
 * 評估 village 表現 — 純函數，無副作用
 * 呼叫端負責寫入 audit_log (THY-07)
 *
 * @param db - SQLite database handle
 * @param villageId - village ID to evaluate
 * @param period - optional time range; defaults to last 24 hours
 */
export function evaluateVillage(
  db: Database,
  villageId: string,
  period?: { from: string; to: string },
): VillageScore {
  const now = new Date().toISOString();
  const effectivePeriod = period ?? {
    from: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    to: now,
  };

  // Count cycles for metadata
  const cycleRow = db
    .prepare(
      `SELECT COUNT(*) as cnt FROM loop_cycles
       WHERE village_id = ? AND created_at >= ? AND created_at <= ?`,
    )
    .get(villageId, effectivePeriod.from, effectivePeriod.to) as {
    cnt: number;
  } | null;
  const cycleCount = cycleRow?.cnt ?? 0;

  // No cycles → score is 0, no meaningful KPI data
  if (cycleCount === 0) {
    return {
      village_id: villageId,
      period: effectivePeriod,
      kpis: {
        completion_rate: 0,
        review_pass_rate: 0,
        rollback_rate: 0,
        budget_efficiency: 0,
        edda_reuse_rate: 0,
      },
      weights: { ...DEFAULT_WEIGHTS },
      composite_score: 0,
      cycle_count: 0,
      computed_at: now,
    };
  }

  const kpis: VillageKpis = {
    completion_rate: computeCompletionRate(
      db,
      villageId,
      effectivePeriod.from,
      effectivePeriod.to,
    ),
    review_pass_rate: computeReviewPassRate(
      db,
      villageId,
      effectivePeriod.from,
      effectivePeriod.to,
    ),
    rollback_rate: computeRollbackRate(
      db,
      villageId,
      effectivePeriod.from,
      effectivePeriod.to,
    ),
    budget_efficiency: computeBudgetEfficiency(
      db,
      villageId,
      effectivePeriod.from,
      effectivePeriod.to,
    ),
    edda_reuse_rate: computeEddaReuseRate(
      db,
      villageId,
      effectivePeriod.from,
      effectivePeriod.to,
    ),
  };

  const compositeScore = computeComposite(kpis, DEFAULT_WEIGHTS);

  return {
    village_id: villageId,
    period: effectivePeriod,
    kpis,
    weights: { ...DEFAULT_WEIGHTS },
    composite_score: compositeScore,
    cycle_count: cycleCount,
    computed_at: now,
  };
}
