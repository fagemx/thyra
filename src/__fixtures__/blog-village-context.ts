/**
 * Blog Village 決策上下文工廠
 *
 * 提供 builder-pattern 的工廠函數，產生符合 Blog Village 真實數據的 DecideContext。
 * 用於 decision-engine golden test fixtures。
 */
import type { DecideContext, BudgetSnapshot } from '../decision-engine';
import type { Chief } from '../chief-engine';
import type { Constitution } from '../constitution-store';
import type { Skill } from '../skill-registry';
import type { Law } from '../law-engine';
import type { CycleIntent } from '../schemas/loop';
import type { LoopAction } from '../schemas/loop';
import type { EddaDecisionHit } from '../edda-bridge';

// ---------------------------------------------------------------------------
// 共用預設值 — 對齊 seedBlogVillage() 的真實資料
// ---------------------------------------------------------------------------

/** Blog Village 預設預算快照（全額可用） */
const DEFAULT_BUDGET: BudgetSnapshot = {
  per_action_limit: 5,
  per_day_limit: 50,
  per_loop_limit: 25,
  spent_today: 0,
  spent_this_loop: 0,
};

// ---------------------------------------------------------------------------
// 型別：overrides 接口
// ---------------------------------------------------------------------------

/** makeBaseContext 的可覆寫欄位 */
export type ContextOverrides = Partial<DecideContext>;

// ---------------------------------------------------------------------------
// 工廠函數
// ---------------------------------------------------------------------------

/**
 * 建立 Blog Village 的基礎 DecideContext。
 *
 * 需要從 seedBlogVillage() 取得真實的 chief、constitution、skills、laws，
 * 確保型別完全正確。覆寫只套用於 DecideContext 層級欄位。
 */
export function makeBaseContext(
  chief: Chief,
  constitution: Constitution,
  skills: Skill[],
  laws: Law[],
  overrides?: ContextOverrides,
): DecideContext {
  return {
    cycle_id: 'cycle-golden-test',
    village_id: chief.village_id,
    iteration: 1,
    max_iterations: 10,
    budget: { ...DEFAULT_BUDGET },
    budget_ratio: 1.0,
    last_action: null,
    completed_action_types: [],
    pending_approvals: 0,
    blocked_count: 0,
    recent_rollbacks: 0,
    edda_precedents: [],
    edda_available: false,
    chief,
    chief_skills: skills,
    constitution,
    active_laws: laws,
    observations: [],
    intent: null,
    ...overrides,
  };
}

/**
 * 冷啟動情境：無 intent、無歷史、第一次迭代。
 * 預期：DecisionEngine 應根據 active_laws 啟動 pipeline（startPipeline → research）。
 */
export function makeColdStartContext(
  chief: Chief,
  constitution: Constitution,
  skills: Skill[],
  laws: Law[],
): DecideContext {
  return makeBaseContext(chief, constitution, skills, laws, {
    cycle_id: 'cycle-cold-start',
    intent: null,
    iteration: 1,
  });
}

/**
 * 流水線中段情境：research 完成，stage_hint=research，last_action 已執行。
 * 預期：DecisionEngine 應推進到 draft 階段。
 */
export function makeMidPipelineContext(
  chief: Chief,
  constitution: Constitution,
  skills: Skill[],
  laws: Law[],
): DecideContext {
  const lastAction: LoopAction = {
    type: 'research',
    description: '研究主題完成',
    estimated_cost: 2.5,
    risk_level: 'low',
    status: 'executed',
    reason: 'Research phase completed',
  };

  const intent: CycleIntent = {
    goal_kind: 'content_pipeline',
    stage_hint: 'research',
    origin_reason: 'Blog pipeline started',
    last_decision_summary: 'Research dispatched',
  };

  return makeBaseContext(chief, constitution, skills, laws, {
    cycle_id: 'cycle-mid-pipeline',
    iteration: 3,
    intent,
    last_action: lastAction,
    completed_action_types: ['research'],
    budget: {
      ...DEFAULT_BUDGET,
      spent_today: 2.5,
      spent_this_loop: 2.5,
    },
    budget_ratio: 0.95,
  });
}

/**
 * 預算耗盡情境：budget_ratio < 0.1，應觸發 complete_cycle。
 */
export function makeBudgetExhaustedContext(
  chief: Chief,
  constitution: Constitution,
  skills: Skill[],
  laws: Law[],
): DecideContext {
  const intent: CycleIntent = {
    goal_kind: 'content_pipeline',
    stage_hint: 'draft',
    origin_reason: 'Blog pipeline in progress',
    last_decision_summary: 'Continuing draft',
  };

  return makeBaseContext(chief, constitution, skills, laws, {
    cycle_id: 'cycle-budget-exhausted',
    iteration: 7,
    intent,
    budget: {
      ...DEFAULT_BUDGET,
      spent_today: 48,
      spent_this_loop: 22,
    },
    budget_ratio: 0.04, // < 0.1 觸發 complete_cycle
  });
}

/**
 * 負面先例情境：Edda 回傳含有 harmful verdict 的歷史決策。
 * 預期：confidence 應被降低（conservative chief → -0.2）。
 */
export function makeNegativePrecedentContext(
  chief: Chief,
  constitution: Constitution,
  skills: Skill[],
  laws: Law[],
): DecideContext {
  const intent: CycleIntent = {
    goal_kind: 'content_pipeline',
    stage_hint: 'draft',
    origin_reason: 'Blog pipeline in progress',
    last_decision_summary: 'Research done, moving to draft',
  };

  const lastAction: LoopAction = {
    type: 'research',
    description: '研究主題完成',
    estimated_cost: 2.5,
    risk_level: 'low',
    status: 'executed',
    reason: 'Research phase completed',
  };

  const negativePrecedent: EddaDecisionHit = {
    event_id: 'edda-neg-001',
    key: 'blog.draft-strategy',
    value: 'harmful: previous draft approach produced low-quality output',
    reason: '上次使用同樣策略產出品質低於標準',
    domain: 'blog',
    branch: 'main',
    ts: new Date().toISOString(),
    is_active: true,
  };

  return makeBaseContext(chief, constitution, skills, laws, {
    cycle_id: 'cycle-negative-precedent',
    iteration: 3,
    intent,
    last_action: lastAction,
    completed_action_types: ['research'],
    edda_precedents: [negativePrecedent],
    edda_available: true,
    budget: {
      ...DEFAULT_BUDGET,
      spent_today: 2.5,
      spent_this_loop: 2.5,
    },
    budget_ratio: 0.95,
  });
}

/**
 * 法律回滾情境：recent_rollbacks >= 3，應觸發 law proposal。
 */
export function makeLawRollbackContext(
  chief: Chief,
  constitution: Constitution,
  skills: Skill[],
  laws: Law[],
): DecideContext {
  const intent: CycleIntent = {
    goal_kind: 'content_pipeline',
    stage_hint: 'review',
    origin_reason: 'Blog pipeline in progress',
    last_decision_summary: 'Draft completed, reviewing',
  };

  const lastAction: LoopAction = {
    type: 'draft',
    description: '撰寫草稿完成',
    estimated_cost: 2.5,
    risk_level: 'low',
    status: 'executed',
    reason: 'Draft phase completed',
  };

  return makeBaseContext(chief, constitution, skills, laws, {
    cycle_id: 'cycle-law-rollback',
    iteration: 5,
    intent,
    last_action: lastAction,
    completed_action_types: ['research', 'draft'],
    recent_rollbacks: 4,
    budget: {
      ...DEFAULT_BUDGET,
      spent_today: 10,
      spent_this_loop: 10,
    },
    budget_ratio: 0.8,
  });
}
