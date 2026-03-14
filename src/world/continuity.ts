/**
 * world/continuity.ts — 跨週期狀態連續性驗證
 *
 * 收集 snapshot 歷史，驗證每個快照的一致性，
 * 展示從建村到當前狀態的演進路徑。
 *
 * @see GitHub issue #124
 */

import type { Database } from 'bun:sqlite';
import { listSnapshots, loadSnapshot } from './snapshot';
import { diffWorldState, type WorldStateDiff } from './diff';
import type { WorldState } from './state';

// ---------------------------------------------------------------------------
// 型別定義
// ---------------------------------------------------------------------------

/** 兩個連續 snapshot 之間的演進步驟 */
export interface ContinuityStep {
  /** 前一個 snapshot id（第一步為 null） */
  from_snapshot_id: string | null;
  /** 當前 snapshot id */
  to_snapshot_id: string;
  /** 與前一個 snapshot 的差異（第一步為 null） */
  diff: WorldStateDiff | null;
  /** 此 snapshot 狀態是否一致（chief permissions ⊆ constitution 等） */
  consistent: boolean;
  /** snapshot 建立時間 */
  timestamp: string;
}

/** 連續性驗證報告 */
export interface ContinuityReport {
  village_id: string;
  total_snapshots: number;
  steps: ContinuityStep[];
  /** 所有步驟都一致 */
  all_consistent: boolean;
  verified_at: string;
}

// ---------------------------------------------------------------------------
// 一致性檢查（單一 snapshot 狀態）
// ---------------------------------------------------------------------------

/**
 * 驗證 WorldState 的內部一致性。
 * 目前檢查 THY-09: 所有 chief 的 permissions ⊆ constitution.allowed_permissions。
 */
function checkStateConsistency(state: WorldState): boolean {
  const constitution = state.constitution;

  // 沒有 constitution 時，不應有 chief（但如果有 chief 卻無 constitution，算不一致）
  if (!constitution) {
    // 無 constitution 且無 chief → 一致（初始狀態）
    // 無 constitution 但有 chief → 不一致
    return state.chiefs.length === 0;
  }

  const allowed = new Set<string>(constitution.allowed_permissions);

  // THY-09: 每個 chief 的 permissions 必須 ⊆ constitution.allowed_permissions
  for (const chief of state.chiefs) {
    for (const perm of chief.permissions) {
      if (!allowed.has(perm)) {
        return false;
      }
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// 主函數
// ---------------------------------------------------------------------------

/**
 * 驗證某個 village 的跨週期狀態連續性。
 *
 * 1. 取得 snapshot 歷史（最近 cycleCount 筆）
 * 2. 按時間正序排列
 * 3. 對每對連續 snapshot 計算 diff
 * 4. 對每個 snapshot 驗證內部一致性
 * 5. 回傳 ContinuityReport
 */
export function verifyContinuity(
  db: Database,
  villageId: string,
  cycleCount?: number,
): ContinuityReport {
  const limit = cycleCount ?? 100;

  // listSnapshots 回傳最新在前，需要反轉成時間正序
  const metas = listSnapshots(db, villageId, limit).reverse();

  if (metas.length === 0) {
    return {
      village_id: villageId,
      total_snapshots: 0,
      steps: [],
      all_consistent: true,
      verified_at: new Date().toISOString(),
    };
  }

  const steps: ContinuityStep[] = [];
  let allConsistent = true;
  let prevState: WorldState | null = null;

  for (let i = 0; i < metas.length; i++) {
    const meta = metas[i];
    const state = loadSnapshot(db, meta.id);

    const consistent = checkStateConsistency(state);
    if (!consistent) allConsistent = false;

    let diff: WorldStateDiff | null = null;
    if (prevState) {
      diff = diffWorldState(prevState, state);
    }

    steps.push({
      from_snapshot_id: i === 0 ? null : metas[i - 1].id,
      to_snapshot_id: meta.id,
      diff,
      consistent,
      timestamp: meta.created_at,
    });

    prevState = state;
  }

  return {
    village_id: villageId,
    total_snapshots: metas.length,
    steps,
    all_consistent: allConsistent,
    verified_at: new Date().toISOString(),
  };
}
