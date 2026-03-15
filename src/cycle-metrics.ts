import type { Database } from 'bun:sqlite';
import { createHash } from 'crypto';
import { appendAudit } from './db';
import type { LoopCycle } from './loop-runner';
import type { DecideContext, DecideResult } from './decision-engine';
import type { CycleMetrics, DecideSnapshot } from './schemas/cycle-metrics';

/**
 * CycleMetricsCollector — 循環指標收集與決策快照
 *
 * 職責：
 * 1. collect(): 從 LoopCycle 萃取量化指標
 * 2. record(): 寫入 audit_log (entity_type='cycle_metrics')
 * 3. snapshot(): 寫入決策快照 (action='decide_snapshot')
 * 4. replay(): 從 audit_log 載入快照用於重播
 *
 * 設計原則：
 * - 全部 static methods，無狀態
 * - 使用既有 audit_log，不新增 DB table
 * - THY-07: append-only audit log
 */
export class CycleMetricsCollector {
  /**
   * 從 LoopCycle 萃取 CycleMetrics
   * 純計算，無副作用
   */
  static collect(cycle: LoopCycle): CycleMetrics {
    const actions = cycle.actions ?? [];

    const actionsExecuted = actions.filter(a => a.status === 'executed').length;
    const actionsBlocked = actions.filter(a => a.status === 'blocked').length;
    const actionsPending = actions.filter(a => a.status === 'pending_approval').length;

    // 預算使用率：cost_incurred / (cost_incurred + budget_remaining)
    const totalBudget = cycle.cost_incurred + cycle.budget_remaining;
    const budgetUsedRatio = totalBudget > 0 ? cycle.cost_incurred / totalBudget : 0;

    return {
      actions_executed: actionsExecuted,
      actions_blocked: actionsBlocked,
      actions_pending: actionsPending,
      budget_used_ratio: budgetUsedRatio,
      laws_proposed: cycle.laws_proposed.length,
      laws_enacted: cycle.laws_enacted.length,
      laws_rolled_back: 0, // 回滾需從 audit_log 查詢，collect 階段先設 0
      edda_queries: 0,     // 需外部注入，collect 階段先設 0
      edda_hits_used: 0,   // 需外部注入，collect 階段先設 0
      reasoning_completeness: 0, // 需外部注入，collect 階段先設 0
    };
  }

  /**
   * 將 CycleMetrics 寫入 audit_log
   * entity_type='cycle_metrics', action='record'
   */
  static record(db: Database, cycleId: string, metrics: CycleMetrics): void {
    appendAudit(db, 'cycle_metrics', cycleId, 'record', metrics, 'system');
  }

  /**
   * 計算 DecideContext 的 SHA-256 hash
   * 用於快速比對兩次決策的輸入是否相同
   */
  static hashContext(context: DecideContext): string {
    const serialized = JSON.stringify(context);
    return createHash('sha256').update(serialized).digest('hex');
  }

  /**
   * 寫入決策快照到 audit_log
   * entity_type='cycle_metrics', action='decide_snapshot'
   */
  static snapshot(
    db: Database,
    context: DecideContext,
    result: DecideResult,
    engineVersion: string,
  ): void {
    const contextHash = CycleMetricsCollector.hashContext(context);

    const snap: DecideSnapshot = {
      context: context as unknown as Record<string, unknown>,
      result: result as unknown as Record<string, unknown>,
      engine_version: engineVersion,
      schema_version: 'snapshot.v1',
      context_hash: contextHash,
    };

    appendAudit(
      db,
      'cycle_metrics',
      context.cycle_id,
      'decide_snapshot',
      snap,
      'system',
    );
  }

  /**
   * 從 audit_log 載入決策快照
   * 回傳 context + result，可用於 replay / 決定性測試
   */
  static replay(
    db: Database,
    snapshotId: number,
  ): { context: DecideContext; result: DecideResult } | null {
    const row = db.prepare(`
      SELECT payload FROM audit_log
      WHERE id = ? AND entity_type = 'cycle_metrics' AND action = 'decide_snapshot'
    `).get(snapshotId) as { payload: string } | null;

    if (!row) return null;

    const snap = JSON.parse(row.payload) as DecideSnapshot;
    return {
      context: snap.context as unknown as DecideContext,
      result: snap.result as unknown as DecideResult,
    };
  }

  /**
   * 按 cycle_id 查詢最近的決策快照
   * 用於 replay 時不知道 audit_log id 的情況
   */
  static getLatestSnapshot(
    db: Database,
    cycleId: string,
  ): { id: number; context: DecideContext; result: DecideResult } | null {
    const row = db.prepare(`
      SELECT id, payload FROM audit_log
      WHERE entity_type = 'cycle_metrics' AND action = 'decide_snapshot'
        AND entity_id = ?
      ORDER BY id DESC LIMIT 1
    `).get(cycleId) as { id: number; payload: string } | null;

    if (!row) return null;

    const snap = JSON.parse(row.payload) as DecideSnapshot;
    return {
      id: row.id,
      context: snap.context as unknown as DecideContext,
      result: snap.result as unknown as DecideResult,
    };
  }
}
