/**
 * world-manager.ts — WorldManager orchestrator class
 *
 * 串接所有 world/ 模組，提供統一入口：
 *   getState → propose → apply → rollback → snapshot → verifyContinuity
 *
 * 核心流程 apply():
 *   1. snapshot (pre_change)
 *   2. judge
 *   3. if rejected → return early
 *   4. applyChange (pure)
 *   5. audit_log
 *   6. return ApplyResult
 *
 * EddaBridge / KarviBridge 為可選 DI。
 * KarviBridge 在 apply() 成功後，對特定 change types 觸發 fire-and-forget dispatch（#186）。
 */

import type { Database } from 'bun:sqlite';
import type { WorldState } from './world/state';
import type { WorldChange } from './schemas/world-change';
import type { JudgeResult } from './world/judge';
import type { RollbackResult } from './world/rollback';
import type { ContinuityReport } from './world/continuity';
import type { WorldStateDiff } from './world/diff';
import type { SnapshotTrigger } from './world/snapshot';
import type { EddaBridge } from './edda-bridge';
import type { KarviBridge } from './karvi-bridge';
import { assembleWorldState } from './world/state';
import { judgeChange } from './world/judge';
import { applyChange } from './world/change';
import { rollbackChange } from './world/rollback';
import { snapshotWorldState } from './world/snapshot';
import { verifyContinuity } from './world/continuity';
import { diffWorldState } from './world/diff';
import { appendAudit } from './db';

// ---------------------------------------------------------------------------
// 型別定義
// ---------------------------------------------------------------------------

/** apply() 的回傳結果 */
export interface ApplyResult {
  /** 是否成功套用 */
  applied: boolean;
  /** judge 結果 */
  judge_result: JudgeResult;
  /** apply 前的 snapshot ID（若 judge 拒絕則仍有 snapshot） */
  snapshot_before: string;
  /** apply 前後的 diff（若 judge 拒絕則為 null） */
  diff: WorldStateDiff | null;
  /** apply 後的 WorldState（若 judge 拒絕則為 null） */
  state_after: WorldState | null;
}

/** 變更提案（listPendingChanges 用，目前為空實作） */
export interface ChangeProposal {
  id: string;
  village_id: string;
  change: WorldChange;
  proposed_at: string;
}

// ---------------------------------------------------------------------------
// WorldManager class
// ---------------------------------------------------------------------------

/** 需要 Karvi 執行的 change types */
const EXECUTABLE_CHANGE_TYPES: ReadonlySet<string> = new Set([
  'law.propose',
  'cycle.start',
]);

export class WorldManager {
  private readonly db: Database;
  readonly eddaBridge: EddaBridge | undefined;
  readonly karviBridge: KarviBridge | undefined;

  constructor(db: Database, eddaBridge?: EddaBridge, karviBridge?: KarviBridge) {
    this.db = db;
    this.eddaBridge = eddaBridge;
    this.karviBridge = karviBridge;
  }

  /** Fire-and-forget: 記錄 world change 事件到 Edda ledger (THY-06 graceful degradation) */
  private recordToEdda(aspect: string, value: string, reason: string): void {
    if (!this.eddaBridge) return;
    void this.eddaBridge.recordDecision({
      domain: 'world',
      aspect,
      value,
      reason,
    }).catch((err: unknown) => {
      console.warn('Edda record failed (non-blocking)', err);
    });
  }

  /**
   * 組裝某個 village 的完整 WorldState。
   * 純讀取，不寫 audit_log。
   */
  getState(villageId: string): WorldState {
    return assembleWorldState(this.db, villageId);
  }

  /**
   * 對一個 WorldChange 進行 5 層驗證（不套用）。
   * 用途：preview / dry-run。
   */
  propose(villageId: string, change: WorldChange): JudgeResult {
    const state = assembleWorldState(this.db, villageId);
    return judgeChange(state, change);
  }

  /**
   * 完整的 apply 流程：
   *   1. snapshot (pre_change)
   *   2. judge
   *   3. if rejected → return early (含 snapshot)
   *   4. applyChange (pure state transform)
   *   5. diff (before vs after)
   *   6. audit_log
   *   7. return ApplyResult
   *
   * 注意：applyChange 是 pure function，不寫 DB。
   * 實際 DB 寫入需由 caller 或後續 Phase 處理。
   * 這裡只做 snapshot + audit 記錄（proof of change）。
   */
  apply(villageId: string, change: WorldChange, reason?: string): ApplyResult {
    // 1. 拍攝 pre-change snapshot
    const snapshotBefore = snapshotWorldState(this.db, villageId, 'pre_change');

    // 2. 組裝當前狀態並 judge
    const stateBefore = assembleWorldState(this.db, villageId);
    const judgeResult = judgeChange(stateBefore, change);

    // 3. 若 judge 拒絕，記錄 audit 並 return early
    if (!judgeResult.allowed) {
      appendAudit(this.db, 'world', villageId, 'change_rejected', {
        change_type: change.type,
        reasons: judgeResult.reasons,
        snapshot_before: snapshotBefore,
        reason,
      }, 'system');

      return {
        applied: false,
        judge_result: judgeResult,
        snapshot_before: snapshotBefore,
        diff: null,
        state_after: null,
      };
    }

    // 4. apply (pure state transform)
    const stateAfter = applyChange(stateBefore, change);

    // 5. diff
    const diff = diffWorldState(stateBefore, stateAfter);

    // 6. audit_log (THY-07)
    appendAudit(this.db, 'world', villageId, 'change_applied', {
      change_type: change.type,
      snapshot_before: snapshotBefore,
      has_changes: diff.has_changes,
      reason,
    }, 'system');

    // 7. fire-and-forget Edda precedent recording (#185)
    this.recordToEdda(
      `${villageId}.change`,
      change.type,
      `applied: ${change.type}, snapshot=${snapshotBefore}, has_changes=${diff.has_changes}${reason ? `, reason=${reason}` : ''}`,
    );

    // 8. 若需要 Karvi 執行，fire-and-forget dispatch（THY-06 graceful degradation）
    if (this.karviBridge && this.needsExecution(change)) {
      this.dispatchToKarvi(villageId, change);
    }

    return {
      applied: true,
      judge_result: judgeResult,
      snapshot_before: snapshotBefore,
      diff,
      state_after: stateAfter,
    };
  }

  /**
   * 判斷變更是否需要 Karvi 執行。
   * law.propose → dispatch 為 Karvi task
   * cycle.start → dispatch cycle execution
   * 其他 → local apply only
   */
  private needsExecution(change: WorldChange): boolean {
    return EXECUTABLE_CHANGE_TYPES.has(change.type);
  }

  /**
   * Fire-and-forget dispatch 到 Karvi（THY-06）。
   * Karvi 斷線不影響 apply 主流程。
   */
  private dispatchToKarvi(villageId: string, change: WorldChange): void {
    const taskId = `${villageId}:${change.type}:${Date.now()}`;
    void this.karviBridge?.dispatchSingleTask(taskId).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : 'unknown';
      appendAudit(this.db, 'world', villageId, 'karvi_dispatch_failed', {
        change_type: change.type,
        task_id: taskId,
        error: message,
      }, 'system');
    });
  }

  /**
   * 執行 rollback：從 snapshot 還原。
   * 委派給 rollbackChange()（已含 audit 寫入）。
   */
  rollback(villageId: string, snapshotId: string, reason: string): RollbackResult {
    const result = rollbackChange(this.db, villageId, snapshotId, reason);

    // fire-and-forget Edda precedent recording (#185)
    this.recordToEdda(
      `${villageId}.rollback`,
      snapshotId,
      `rollback: snapshot=${snapshotId}, reason=${reason}`,
    );

    return result;
  }

  /**
   * 拍攝 WorldState snapshot，回傳 snapshot_id。
   */
  snapshot(villageId: string, trigger: SnapshotTrigger): string {
    return snapshotWorldState(this.db, villageId, trigger);
  }

  /**
   * 驗證某個 village 的跨週期狀態連續性。
   */
  verifyContinuity(villageId: string): ContinuityReport {
    return verifyContinuity(this.db, villageId);
  }

  /**
   * 列出 pending changes（目前為空實作，Phase 2 實現 change queue）。
   */
  listPendingChanges(_villageId: string): ChangeProposal[] {
    return [];
  }
}
