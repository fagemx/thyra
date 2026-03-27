/**
 * reputation-tracker.ts -- Chief 聲望追蹤系統 (#216)
 *
 * 追蹤 chief 的提案成功率、rollback 次數，計算聲望分數。
 * 遵循 CycleTelemetryCollector 的 static-method 模式。
 *
 * 層級定位：同 chief-engine（DB-backed store），不 import 上層。
 *
 * Phase 1 功能：
 *   - getOrCreate: lazy init（首次觸發時自動建立 score=100）
 *   - recordProposal: 提案通過 +1 / 拒絕 -1
 *   - recordRollback: rollback -2
 *   - recordCycleResult: 批量處理 ChiefCycleResult
 *
 * 所有 score 更新使用原子 SQL（MAX/MIN clamp），無 read-modify-write race。
 */

import type { Database } from 'bun:sqlite';
import { appendAudit } from './db';
import type { ChiefReputation } from './schemas/reputation';
import {
  DEFAULT_REWARDS,
  INITIAL_SCORE,
  SCORE_FLOOR,
  SCORE_CEILING,
} from './schemas/reputation';

// ChiefCycleResult 的最小必要子型別（避免 import chief-autonomy 上層）
interface CycleResultLike {
  chief_id: string;
  applied: ReadonlyArray<{ applied: boolean }>;
  skipped: ReadonlyArray<unknown>;
}

// ---------------------------------------------------------------------------
// Raw DB row type
// ---------------------------------------------------------------------------

interface RawReputationRow {
  chief_id: string;
  village_id: string;
  score: number;
  proposals_applied: number;
  proposals_rejected: number;
  proposals_skipped: number;
  rollbacks_triggered: number;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// ReputationTracker
// ---------------------------------------------------------------------------

export class ReputationTracker {
  /**
   * 取得 chief 的聲望記錄（不存在回傳 null）。
   */
  static get(db: Database, chiefId: string): ChiefReputation | null {
    const row = db.prepare(`
      SELECT chief_id, village_id, score, proposals_applied, proposals_rejected,
             proposals_skipped, rollbacks_triggered, updated_at
      FROM chief_reputation
      WHERE chief_id = ?
    `).get(chiefId) as RawReputationRow | null;

    return row ?? null;
  }

  /**
   * 取得或建立 chief 聲望記錄（lazy init，score=100）。
   */
  static getOrCreate(db: Database, chiefId: string, villageId: string): ChiefReputation {
    const existing = ReputationTracker.get(db, chiefId);
    if (existing) return existing;

    const now = new Date().toISOString();
    db.prepare(`
      INSERT OR IGNORE INTO chief_reputation
        (chief_id, village_id, score, proposals_applied, proposals_rejected, proposals_skipped, rollbacks_triggered, updated_at)
      VALUES (?, ?, ?, 0, 0, 0, 0, ?)
    `).run(chiefId, villageId, INITIAL_SCORE, now);

    // INSERT OR IGNORE 可能因 PK 衝突而不 insert（並發），再讀一次
    const result = ReputationTracker.get(db, chiefId);
    if (!result) {
      throw new Error(`Failed to create reputation record for chief ${chiefId}`);
    }
    return result;
  }

  /**
   * 列出一個 village 的所有 chief 聲望記錄。
   */
  static list(db: Database, villageId: string): ChiefReputation[] {
    const rows = db.prepare(`
      SELECT chief_id, village_id, score, proposals_applied, proposals_rejected,
             proposals_skipped, rollbacks_triggered, updated_at
      FROM chief_reputation
      WHERE village_id = ?
      ORDER BY score DESC
    `).all(villageId) as RawReputationRow[];

    return rows;
  }

  /**
   * 記錄提案結果：applied=true → +1 score，applied=false → -1 score。
   * 自動 lazy init。
   */
  static recordProposal(db: Database, chiefId: string, villageId: string, applied: boolean): void {
    // 確保記錄存在
    ReputationTracker.getOrCreate(db, chiefId, villageId);

    const delta = applied ? DEFAULT_REWARDS.proposal_applied : DEFAULT_REWARDS.proposal_rejected;
    const now = new Date().toISOString();

    if (applied) {
      db.prepare(`
        UPDATE chief_reputation
        SET score = MAX(?, MIN(?, score + ?)),
            proposals_applied = proposals_applied + 1,
            updated_at = ?
        WHERE chief_id = ?
      `).run(SCORE_FLOOR, SCORE_CEILING, delta, now, chiefId);
    } else {
      db.prepare(`
        UPDATE chief_reputation
        SET score = MAX(?, MIN(?, score + ?)),
            proposals_rejected = proposals_rejected + 1,
            updated_at = ?
        WHERE chief_id = ?
      `).run(SCORE_FLOOR, SCORE_CEILING, delta, now, chiefId);
    }

    // THY-07: audit log
    appendAudit(db, 'reputation', chiefId, applied ? 'proposal_applied' : 'proposal_rejected', {
      delta,
      village_id: villageId,
    }, 'system');
  }

  /**
   * 記錄 rollback：-2 score。
   * 自動 lazy init。
   */
  static recordRollback(db: Database, chiefId: string, villageId: string): void {
    ReputationTracker.getOrCreate(db, chiefId, villageId);

    const delta = DEFAULT_REWARDS.rollback_triggered;
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE chief_reputation
      SET score = MAX(?, MIN(?, score + ?)),
          rollbacks_triggered = rollbacks_triggered + 1,
          updated_at = ?
      WHERE chief_id = ?
    `).run(SCORE_FLOOR, SCORE_CEILING, delta, now, chiefId);

    // THY-07: audit log
    appendAudit(db, 'reputation', chiefId, 'rollback_triggered', {
      delta,
      village_id: villageId,
    }, 'system');
  }

  /**
   * 批量記錄 ChiefCycleResult 的聲望變動。
   *
   * applied.length 筆 +1 score。skipped 不影響 score（#403: skipped != rejected）。
   * 如果 applied + skipped 都是 0，不做任何操作（不建立記錄）。
   */
  static recordCycleResult(db: Database, villageId: string, result: CycleResultLike): void {
    const appliedCount = result.applied.length;
    const skippedCount = result.skipped.length;

    if (appliedCount === 0 && skippedCount === 0) return;

    // 確保記錄存在
    ReputationTracker.getOrCreate(db, result.chief_id, villageId);

    // #403: skipped proposals 不計入 rejected，也不扣 score
    const delta = appliedCount * DEFAULT_REWARDS.proposal_applied;
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE chief_reputation
      SET score = MAX(?, MIN(?, score + ?)),
          proposals_applied = proposals_applied + ?,
          proposals_skipped = proposals_skipped + ?,
          updated_at = ?
      WHERE chief_id = ?
    `).run(SCORE_FLOOR, SCORE_CEILING, delta, appliedCount, skippedCount, now, result.chief_id);

    // THY-07: audit log
    appendAudit(db, 'reputation', result.chief_id, 'cycle_result', {
      applied_count: appliedCount,
      skipped_count: skippedCount,
      delta,
      village_id: villageId,
    }, 'system');
  }
}
