/**
 * world/rollback.ts — change-level rollback：從 snapshot 還原 WorldState。
 *
 * 策略（Phase 2）：
 *   1. 從 pre-change snapshot 載入目標狀態
 *   2. 組裝當前 live state
 *   3. 計算 diff（當前 → 目標）
 *   4. 拍攝 rollback 前備份 snapshot
 *   5. applyToDb — 在 transaction 內還原所有 DB tables
 *   6. 記錄 audit_log
 *   7. 回傳 RollbackResult
 */

import type { Database } from 'bun:sqlite';
import type { WorldStateDiff } from './diff';
import type { WorldState } from './state';
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
// applyToDb — 在 transaction 內還原 DB tables（Phase 2 核心）
// ---------------------------------------------------------------------------

/**
 * 在 transaction 內原子還原 DB tables 到 snapshot 狀態。
 *
 * 還原範圍：villages（metadata）、constitutions、chiefs、laws、skills。
 * 不還原 loop_cycles（running cycles 不可逆）和 audit_log（append-only）。
 *
 * 順序考量（FK constraints）：
 *   刪除：laws → chiefs → constitutions → skills（village-owned）→ 更新 village
 *   插入：village → constitutions → chiefs → laws → skills
 *
 * @throws Error 如果任何步驟失敗（transaction 自動 rollback）
 */
export function applyToDb(
  db: Database,
  villageId: string,
  targetState: WorldState,
): void {
  const tx = db.transaction(() => {
    // --- 刪除現有的 village-scoped 資料（子表先刪）---
    db.prepare('DELETE FROM laws WHERE village_id = ?').run(villageId);
    db.prepare('DELETE FROM chiefs WHERE village_id = ?').run(villageId);
    db.prepare('DELETE FROM constitutions WHERE village_id = ?').run(villageId);
    db.prepare('DELETE FROM skills WHERE village_id = ?').run(villageId);

    // --- 更新 village metadata ---
    const v = targetState.village;
    db.prepare(`
      UPDATE villages
      SET name = ?, description = ?, target_repo = ?, status = ?,
          metadata = ?, version = ?, updated_at = ?
      WHERE id = ?
    `).run(
      v.name, v.description, v.target_repo, v.status,
      JSON.stringify(v.metadata), v.version, v.updated_at, v.id,
    );

    // --- 插入 snapshot 中的 constitution ---
    const con = targetState.constitution;
    if (con) {
      db.prepare(`
        INSERT INTO constitutions (id, village_id, version, status, created_at, created_by,
          rules, allowed_permissions, budget_limits, superseded_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        con.id, con.village_id, con.version, con.status, con.created_at, con.created_by,
        JSON.stringify(con.rules), JSON.stringify(con.allowed_permissions),
        JSON.stringify(con.budget_limits), con.superseded_by,
      );
    }

    // --- 插入 snapshot 中的 chiefs ---
    for (const c of targetState.chiefs) {
      db.prepare(`
        INSERT INTO chiefs (id, village_id, name, role, version, status,
          skills, permissions, personality, constraints, profile, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        c.id, c.village_id, c.name, c.role, c.version, c.status,
        JSON.stringify(c.skills), JSON.stringify(c.permissions),
        JSON.stringify(c.personality), JSON.stringify(c.constraints),
        c.profile ?? null, c.created_at, c.updated_at,
      );
    }

    // --- 插入 snapshot 中的 active laws ---
    for (const l of targetState.active_laws) {
      db.prepare(`
        INSERT INTO laws (id, village_id, proposed_by, approved_by, version, status,
          category, content, risk_level, evidence, effectiveness, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        l.id, l.village_id, l.proposed_by, l.approved_by, l.version, l.status,
        l.category, JSON.stringify(l.content), l.risk_level,
        JSON.stringify(l.evidence),
        l.effectiveness ? JSON.stringify(l.effectiveness) : null,
        l.created_at, l.updated_at,
      );
    }

    // --- 插入 snapshot 中的 village-owned skills ---
    // 只還原屬於此 village 的 skills（非 global、非 shared）
    for (const s of targetState.skills) {
      if (s.village_id !== villageId) continue;
      db.prepare(`
        INSERT INTO skills (id, name, version, status, village_id,
          definition, created_at, updated_at, verified_at, verified_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        s.id, s.name, s.version, s.status, s.village_id,
        JSON.stringify(s.definition), s.created_at, s.updated_at,
        s.verified_at, s.verified_by,
      );
    }
  });

  // 執行 transaction — 任何步驟失敗自動 rollback
  tx();
}

// ---------------------------------------------------------------------------
// 主函數
// ---------------------------------------------------------------------------

/**
 * 執行 change-level rollback：從 snapshot 還原 WorldState 並寫入 DB。
 *
 * @param db - SQLite database handle
 * @param villageId - 目標 village ID
 * @param snapshotId - 要還原到的 pre-change snapshot ID
 * @param reason - rollback 原因（記入 audit_log）
 * @returns RollbackResult，含 diff 和備份 snapshot ID
 *
 * @throws Error 如果 snapshot 不存在
 * @throws Error 如果 snapshot 的 village 與 villageId 不符
 * @throws Error 如果 DB 還原失敗（transaction 自動 rollback，不影響原資料）
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

  // 6. 實際還原 DB tables（Phase 2）
  applyToDb(db, villageId, targetState);

  // 7. 寫入 audit_log（THY-07）
  appendAudit(db, 'world', villageId, 'rollback', {
    snapshot_id: snapshotId,
    rollback_snapshot_id: rollbackSnapshotId,
    reason,
    has_changes: diff.has_changes,
    restored: true,
  }, 'system');

  return {
    success: true,
    snapshot_id: snapshotId,
    rollback_snapshot_id: rollbackSnapshotId,
    diff,
    reason,
  };
}
