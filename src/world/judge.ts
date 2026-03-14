/**
 * world/judge.ts — change-level 驗證管線
 *
 * 4 層管線：Safety → Legality → Boundary → Consistency
 * Pure function，無 DB 依賴。接收 WorldState + WorldChange，回傳 JudgeResult。
 *
 * Safety Invariants 改編自 src/risk-assessor.ts (THY-12)。
 */

import type { WorldState } from './state';
import type { WorldChange } from '../schemas/world-change';
import type { Permission } from '../schemas/constitution';
import { applyChange } from './change';

// ---------------------------------------------------------------------------
// JudgeResult 型別
// ---------------------------------------------------------------------------

export interface JudgeResult {
  allowed: boolean;
  reasons: string[];
  safety_check: boolean;
  legality_check: boolean;
  boundary_check: boolean;
  consistency_check: boolean;
}

// ---------------------------------------------------------------------------
// 需要 constitution 存在才能操作的 change types
// ---------------------------------------------------------------------------

const REQUIRES_CONSTITUTION: ReadonlySet<string> = new Set([
  'law.propose',
  'law.enact',
  'law.repeal',
  'chief.appoint',
  'chief.dismiss',
  'chief.update_permissions',
  'budget.adjust',
  'cycle.start',
]);

// ---------------------------------------------------------------------------
// Layer 1: Safety Invariants (THY-12 — 硬編碼，不可覆寫)
// ---------------------------------------------------------------------------

function checkSafety(state: WorldState, change: WorldChange): string[] {
  const reasons: string[] = [];

  // SI-1: 治理類變更需要 constitution 存在
  if (REQUIRES_CONSTITUTION.has(change.type) && !state.constitution) {
    reasons.push(`SI-1: ${change.type} 需要 constitution 存在`);
  }

  // SI-4: budget 數值不能是負數，且不能超過合理上限 (100000)
  if (change.type === 'budget.adjust') {
    const fields = [
      { key: 'max_cost_per_action', val: change.max_cost_per_action },
      { key: 'max_cost_per_day', val: change.max_cost_per_day },
      { key: 'max_cost_per_loop', val: change.max_cost_per_loop },
    ];
    for (const { key, val } of fields) {
      if (val !== undefined && val < 0) {
        reasons.push(`SI-4: ${key} 不能為負數`);
      }
      if (val !== undefined && val > 100000) {
        reasons.push(`SI-4: ${key} 超過安全上限 (100000)`);
      }
    }
  }

  // SI-4: constitution.supersede 的 budget 也要檢查
  if (change.type === 'constitution.supersede') {
    const bl = change.budget_limits;
    if (bl.max_cost_per_action < 0 || bl.max_cost_per_day < 0 || bl.max_cost_per_loop < 0) {
      reasons.push('SI-4: budget 數值不能為負數');
    }
  }

  // SI-7: 不能 dismiss 最後一個 chief
  if (change.type === 'chief.dismiss') {
    const activeChiefs = state.chiefs.filter((c) => c.status === 'active');
    if (activeChiefs.length <= 1) {
      const isLastChief = activeChiefs.length === 0 || activeChiefs[0].id === change.chief_id;
      if (isLastChief) {
        reasons.push('SI-7: 不能解任最後一位 chief');
      }
    }
  }

  return reasons;
}

// ---------------------------------------------------------------------------
// Layer 2: Legality — 變更是否在 constitution 允許範圍內
// ---------------------------------------------------------------------------

function checkLegality(state: WorldState, change: WorldChange): string[] {
  const reasons: string[] = [];
  const constitution = state.constitution;

  // constitution.supersede 和 village.update 永遠合法（基本治理機制）
  if (change.type === 'constitution.supersede' || change.type === 'village.update') {
    return reasons;
  }

  // 無 constitution 時已在 safety 層處理
  if (!constitution) return reasons;

  const allowed = new Set<string>(constitution.allowed_permissions);

  // chief.appoint: 新 chief 的 permissions 必須 ⊆ constitution.allowed_permissions
  if (change.type === 'chief.appoint') {
    const invalid = change.permissions.filter((p) => !allowed.has(p));
    if (invalid.length > 0) {
      reasons.push(`LEGALITY: chief 權限 [${invalid.join(', ')}] 不在 constitution 允許範圍內`);
    }
  }

  // chief.update_permissions: 新權限必須 ⊆ constitution.allowed_permissions
  if (change.type === 'chief.update_permissions') {
    const invalid = change.permissions.filter((p) => !allowed.has(p));
    if (invalid.length > 0) {
      reasons.push(`LEGALITY: 更新後權限 [${invalid.join(', ')}] 不在 constitution 允許範圍內`);
    }
  }

  // law.propose: 提案者必須是已存在的 chief
  if (change.type === 'law.propose') {
    const chiefExists = state.chiefs.some((c) => c.id === change.proposed_by);
    if (!chiefExists) {
      reasons.push(`LEGALITY: 提案者 ${change.proposed_by} 不是現有 chief`);
    }
  }

  // law.enact: 需要 enact_law_low 或相關權限
  if (change.type === 'law.enact') {
    if (!allowed.has('enact_law_low')) {
      reasons.push('LEGALITY: constitution 未授權 enact_law_low 權限');
    }
  }

  return reasons;
}

// ---------------------------------------------------------------------------
// Layer 3: Boundary — 預算上限、權限範圍
// ---------------------------------------------------------------------------

function checkBoundary(state: WorldState, change: WorldChange): string[] {
  const reasons: string[] = [];
  const constitution = state.constitution;

  if (!constitution) return reasons;

  // budget.adjust: 新數值不能超過 constitution 原始上限的 10 倍（合理性檢查）
  if (change.type === 'budget.adjust') {
    const currentLimits = constitution.budget_limits;
    if (change.max_cost_per_action !== undefined && change.max_cost_per_action > currentLimits.max_cost_per_action * 10) {
      reasons.push(`BOUNDARY: max_cost_per_action (${change.max_cost_per_action}) 超過當前上限的 10 倍`);
    }
    if (change.max_cost_per_day !== undefined && change.max_cost_per_day > currentLimits.max_cost_per_day * 10) {
      reasons.push(`BOUNDARY: max_cost_per_day (${change.max_cost_per_day}) 超過當前上限的 10 倍`);
    }
    if (change.max_cost_per_loop !== undefined && change.max_cost_per_loop > currentLimits.max_cost_per_loop * 10) {
      reasons.push(`BOUNDARY: max_cost_per_loop (${change.max_cost_per_loop}) 超過當前上限的 10 倍`);
    }
  }

  // skill.register 和 skill.revoke 不需邊界檢查

  return reasons;
}

// ---------------------------------------------------------------------------
// Layer 4: Consistency — apply 後狀態是否一致
// ---------------------------------------------------------------------------

function checkConsistency(state: WorldState, change: WorldChange): string[] {
  const reasons: string[] = [];

  // 嘗試 apply change
  let afterState: WorldState;
  try {
    afterState = applyChange(state, change);
  } catch {
    reasons.push('CONSISTENCY: applyChange 失敗');
    return reasons;
  }

  const constitution = afterState.constitution;
  if (!constitution) return reasons;

  const allowedPerms = new Set<string>(constitution.allowed_permissions);

  // 所有 chief 的 permissions 必須 ⊆ constitution.allowed_permissions (THY-09)
  for (const chief of afterState.chiefs) {
    const invalid = chief.permissions.filter((p: Permission) => !allowedPerms.has(p));
    if (invalid.length > 0) {
      reasons.push(
        `CONSISTENCY: chief "${chief.name}" 的權限 [${invalid.join(', ')}] 超出 constitution 允許範圍 (THY-09)`,
      );
    }
  }

  // 所有 active law 的 proposed_by 必須指向存在的 chief（或已被 dismiss 的 chief）
  // 這裡只做輕量檢查：如果 law 狀態是 active，category 不應為空
  for (const law of afterState.active_laws) {
    if (law.status === 'active' && !law.category) {
      reasons.push(`CONSISTENCY: law ${law.id} 缺少 category`);
    }
  }

  return reasons;
}

// ---------------------------------------------------------------------------
// 主函數
// ---------------------------------------------------------------------------

/**
 * 對一個 WorldChange 進行 4 層驗證管線。
 *
 * 1. Safety — 硬編碼安全檢查（SI-1, SI-4, SI-7）
 * 2. Legality — constitution 允許範圍
 * 3. Boundary — 預算上限、合理性
 * 4. Consistency — apply 後狀態一致性
 *
 * 回傳 JudgeResult，其中 allowed = 所有層都通過。
 */
export function judgeChange(state: WorldState, change: WorldChange): JudgeResult {
  const safetyReasons = checkSafety(state, change);
  const legalityReasons = checkLegality(state, change);
  const boundaryReasons = checkBoundary(state, change);
  const consistencyReasons = checkConsistency(state, change);

  const safety_check = safetyReasons.length === 0;
  const legality_check = legalityReasons.length === 0;
  const boundary_check = boundaryReasons.length === 0;
  const consistency_check = consistencyReasons.length === 0;

  const reasons = [...safetyReasons, ...legalityReasons, ...boundaryReasons, ...consistencyReasons];
  const allowed = reasons.length === 0;

  return {
    allowed,
    reasons,
    safety_check,
    legality_check,
    boundary_check,
    consistency_check,
  };
}
