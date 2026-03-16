import type { WorldState } from './state';

/** 世界健康度指標 — 從 WorldState 純計算 */
export interface WorldHealth {
  /** 加權總分 0-100 */
  overall: number;
  /** 活躍 chief 數量 */
  chief_count: number;
  /** 活躍 law 數量 */
  law_count: number;
  /** 可用 skill 數量 */
  skill_count: number;
  /** 預算使用率 (0.0-1.0+) */
  budget_utilization: number;
  /** 距上次變更的毫秒數 */
  last_change_age_ms: number;
  /** 是否有生效的 constitution */
  constitution_active: boolean;
  /** 正在執行的 cycle 數量 */
  cycle_count: number;
  /** 各維度子分數（debug / dashboard 用） */
  scores: {
    chief: number;
    constitution: number;
    law: number;
    skill: number;
    budget: number;
    freshness: number;
  };
}

// --- 子分數計算 (tiered thresholds) ---

/** Chief 分數：0→0, 1→50, 2→80, 3+→100 */
export function chiefScore(count: number): number {
  if (count === 0) return 0;
  if (count === 1) return 50;
  if (count === 2) return 80;
  return 100;
}

/** Constitution 分數：有→100, 無→0 */
export function constitutionScore(active: boolean): number {
  return active ? 100 : 0;
}

/** Law 分數：0→0, 1→30, 2→50, 3→70, 4→85, 5+→100 */
export function lawScore(count: number): number {
  if (count === 0) return 0;
  if (count === 1) return 30;
  if (count === 2) return 50;
  if (count === 3) return 70;
  if (count === 4) return 85;
  return 100;
}

/** Skill 分數：同 lawScore 的 tier */
export function skillScore(count: number): number {
  if (count === 0) return 0;
  if (count === 1) return 30;
  if (count === 2) return 50;
  if (count === 3) return 70;
  if (count === 4) return 85;
  return 100;
}

/**
 * Budget 分數：
 * - 沒有 constitution → 0（無預算配置 = 不健康）
 * - 0-70% 使用率 → 100
 * - 70-90% → 線性下降到 50
 * - 90-100% → 線性下降到 0
 * - >100% → 0（超支）
 */
export function budgetScore(utilization: number, hasConstitution: boolean): number {
  if (!hasConstitution) return 0;
  if (utilization <= 0.7) return 100;
  if (utilization <= 0.9) return Math.round(100 - (utilization - 0.7) * 250);
  if (utilization <= 1.0) return Math.round(50 - (utilization - 0.9) * 500);
  return 0;
}

/**
 * Freshness 分數（依據距上次變更的時間）：
 * - <1h → 100
 * - <6h → 80
 * - <24h → 60
 * - <72h → 30
 * - else → 10
 */
export function freshnessScore(ageMs: number): number {
  const safeAge = Math.max(0, ageMs); // 防止時鐘偏差造成負值
  const hours = safeAge / (1000 * 60 * 60);
  if (hours < 1) return 100;
  if (hours < 6) return 80;
  if (hours < 24) return 60;
  if (hours < 72) return 30;
  return 10;
}

/**
 * 從 WorldState 計算世界健康度。
 * 純函數：相同輸入 + 相同 now → 相同輸出。
 *
 * @param state - 世界狀態快照
 * @param now - 當前時間戳（epoch ms），預設 Date.now()，供測試用
 */
export function computeWorldHealth(state: WorldState, now?: number): WorldHealth {
  const currentTime = now ?? Date.now();

  // 提取計數
  const chief_count = state.chiefs.length;
  const law_count = state.active_laws.length;
  const skill_count = state.skills.length;
  const constitution_active = state.constitution !== null;
  const cycle_count = state.running_cycles.length;

  // 預算使用率：running_cycles 的 cost_incurred 加總 / constitution 每日預算上限
  const totalCostIncurred = state.running_cycles.reduce(
    (sum, c) => sum + c.cost_incurred, 0
  );
  const dailyBudget = state.constitution?.budget_limits.max_cost_per_day ?? 0;
  const budget_utilization = dailyBudget > 0 ? totalCostIncurred / dailyBudget : 0;

  // Freshness：距離 village 最後更新的時間
  const last_change_age_ms = currentTime - Date.parse(state.village.updated_at);

  // 計算子分數
  const scores = {
    chief: chiefScore(chief_count),
    constitution: constitutionScore(constitution_active),
    law: lawScore(law_count),
    skill: skillScore(skill_count),
    budget: budgetScore(budget_utilization, constitution_active),
    freshness: freshnessScore(last_change_age_ms),
  };

  // 加權總分（weights 加總 = 100，所以直接除 100 等於乘以各自權重比例）
  const overall = Math.round(
    scores.chief * 0.20 +
    scores.constitution * 0.20 +
    scores.law * 0.15 +
    scores.skill * 0.15 +
    scores.budget * 0.15 +
    scores.freshness * 0.15
  );

  return {
    overall,
    chief_count,
    law_count,
    skill_count,
    budget_utilization,
    last_change_age_ms,
    constitution_active,
    cycle_count,
    scores,
  };
}
