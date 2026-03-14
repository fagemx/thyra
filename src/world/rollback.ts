/**
 * world/rollback.ts — change-level rollback：從 snapshot 還原 WorldState。
 *
 * 策略（v1）：
 *   1. 從 pre-change snapshot 載入目標狀態
 *   2. 組裝當前 live state
 *   3. 計算 diff（當前 → 目標）
 *   4. 拍攝 rollback 前備份 snapshot
 *   5. 記錄 audit_log
 *   6. 回傳 RollbackResult
 *
 * 不做實際 table 還原（Phase 2），只記錄意圖 + diff。
 */

import type { Database } from 'bun:sqlite';
import type { WorldStateDiff } from './diff';
import { loadSnapshot } from './snapshot';
import { snapshotWorldState } from './snapshot';
import { assembleWorldState } from './state';
import { diffWorldState } from './diff';
import { appendAudit } from '../db';

// ---------------------------------------------------------------------------
// 型別定義
// ---------------------------------------------------------------------------

export interface RollbackResult {
  /** rollback 是否成功 */
  success: boolean;
  /** 還原來源的 pre-change snapshot ID */
  snapshot_id: string;
  /** rollback 前拍攝的備份 snapshot ID */
  rollback_snapshot_id: string;
  /** 當前狀態與還原目標之間的 diff */
  diff: WorldStateDiff;
  /** rollback 原因 */
  reason: string;
}

// ---------------------------------------------------------------------------
// 主函數
// ---------------------------------------------------------------------------

/**
 * 執行 change-level rollback。
 *
 * @param db - SQLite database handle
 * @param villageId - 目標 village ID
 * @param snapshotId - 要還原到的 pre-change snapshot ID
 * @param reason - rollback 原因（記入 audit_log）
 * @returns RollbackResult，含 diff 和備份 snapshot ID
 *
 * @throws Error 如果 snapshot 不存在
 * @throws Error 如果 snapshot 的 village 與 villageId 不符
 */
export function rollbackChange(
  db: Database,
  villageId: string,
  snapshotId: string,
  reason: string,
): RollbackResult {
  // 1. 載入目標 snapshot
  const targetState = loadSnapshot(db, snapshotId);

  // 2. 驗證 snapshot 歸屬
  if (targetState.village.id !== villageId) {
    throw new Error(
      `Snapshot ${snapshotId} belongs to village ${targetState.village.id}, not ${villageId}`,
    );
  }

  // 3. 組裝當前 live state
  const currentState = assembleWorldState(db, villageId);

  // 4. 拍攝 rollback 前的備份 snapshot（用 'manual' trigger）
  const rollbackSnapshotId = snapshotWorldState(db, villageId, 'manual');

  // 5. 計算 diff（當前 → 目標）
  const diff = diffWorldState(currentState, targetState);

  // 6. 寫入 audit_log（THY-07）
  appendAudit(db, 'world', villageId, 'rollback', {
    snapshot_id: snapshotId,
    rollback_snapshot_id: rollbackSnapshotId,
    reason,
    has_changes: diff.has_changes,
  }, 'system');

  return {
    success: true,
    snapshot_id: snapshotId,
    rollback_snapshot_id: rollbackSnapshotId,
    diff,
    reason,
  };
}
