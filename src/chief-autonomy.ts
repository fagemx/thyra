/**
 * chief-autonomy.ts -- Chief 自主決策協定
 *
 * 讓 AI chiefs 能自主觀察 WorldState 並產生 WorldChange proposals。
 * Phase 1: rule-based（不用 LLM）。
 *
 * 核心流程：
 *   1. resolveStrategy(chief) -- 根據 role 選擇決策策略
 *   2. makeChiefDecision(chief, state) -- 觀察 state，產生 proposals
 *   3. executeChiefCycle(worldManager, villageId, chief) -- 完整執行一輪
 *
 * 所有 proposal 都經過 WorldManager.apply()（含 4 層 judge pipeline）。
 *
 * 層級定位：同 chief-engine（不 import loop-runner / decision-engine）。
 */

import type { Chief } from './chief-engine';
import type { PrecedentConfig } from './schemas/chief';
import type { WorldManager, ApplyResult } from './world-manager';
import type { KarviBridge, KarviProjectResponse } from './karvi-bridge';
import type { EddaBridge, EddaDecisionHit } from './edda-bridge';
import type { WorldState } from './world/state';
import type { WorldChange } from './schemas/world-change';

// ---------------------------------------------------------------------------
// 型別定義
// ---------------------------------------------------------------------------

/** Chief 決策提案（含推理，符合 SI-2） */
export interface ChiefProposal {
  /** 要提交的 WorldChange */
  change: WorldChange;
  /** 提案理由（SI-2: traceable reasoning） */
  reason: string;
  /** 信心度 0-1，personality 可調整閾值 */
  confidence: number;
  /** 觸發觀察（什麼狀態觸發了此提案） */
  trigger: string;
}

/** 單一 chief 決策週期結果 */
export interface ChiefCycleResult {
  chief_id: string;
  proposals: ChiefProposal[];
  applied: ApplyResult[];
  skipped: { proposal: ChiefProposal; reason: string }[];
}

/** Chief 決策上下文（含可選的 Edda 先例） */
export interface ChiefDecisionContext {
  state: WorldState;
  /** Edda 歷史先例（use_precedents=false 或 Edda 離線時為空陣列） */
  precedents: EddaDecisionHit[];
}

/** 策略函數類型 -- pure function，無副作用 */
export type ChiefStrategy = (chief: Chief, ctx: ChiefDecisionContext) => ChiefProposal[];

// ---------------------------------------------------------------------------
// 角色策略實作
// ---------------------------------------------------------------------------

/**
 * Economy 策略：監控預算使用狀況。
 * 觸發條件：running_cycles > 0 且 constitution 有預算限制時，
 * 以 running cycles 數量作為高負載指標，提議調降預算。
 */
export function economyStrategy(_chief: Chief, ctx: ChiefDecisionContext): ChiefProposal[] {
  const proposals: ChiefProposal[] = [];
  const { state, precedents } = ctx;
  const constitution = state.constitution;
  if (!constitution) return proposals;

  const runningCount = state.running_cycles.length;
  const limits = constitution.budget_limits;

  // 高活動量 + 預算存在 → 提議調降 per-action 預算 20%
  if (runningCount > 0 && limits.max_cost_per_action > 0) {
    const newLimit = Math.round(limits.max_cost_per_action * 0.8 * 100) / 100;
    const confidence = adjustConfidenceWithPrecedents(0.7, 'budget', precedents);
    proposals.push({
      change: {
        type: 'budget.adjust',
        max_cost_per_action: newLimit,
      },
      reason: `High activity detected: ${runningCount} running cycle(s). Reducing per-action budget by 20% to maintain fiscal discipline.`,
      confidence,
      trigger: `running_cycles.length=${runningCount}, current max_cost_per_action=${limits.max_cost_per_action}`,
    });
  }

  return proposals;
}

/**
 * Event 策略：確保足夠的治理法規。
 * 觸發條件：active_laws < 3 → 提議新法。
 */
export function eventStrategy(chief: Chief, ctx: ChiefDecisionContext): ChiefProposal[] {
  const proposals: ChiefProposal[] = [];
  const { state, precedents } = ctx;

  if (state.active_laws.length < 3) {
    // 找出是否缺少 governance 類法規
    const hasGovernance = state.active_laws.some(l => l.category === 'governance');
    const category = hasGovernance ? 'operational' : 'governance';

    const confidence = adjustConfidenceWithPrecedents(0.6, 'law', precedents);
    proposals.push({
      change: {
        type: 'law.propose',
        proposed_by: chief.id,
        category,
        content: {
          description: `Auto-proposed ${category} policy to ensure minimum governance coverage`,
          strategy: { auto_generated: true, min_laws_threshold: 3 },
        },
        risk_level: 'low',
      },
      reason: `Village has only ${state.active_laws.length} active law(s), below minimum threshold of 3. Proposing ${category} policy.`,
      confidence,
      trigger: `active_laws.length=${state.active_laws.length}`,
    });
  }

  return proposals;
}

/**
 * Safety 策略：偵測 THY-09 權限違規。
 * 觸發條件：chief permissions 不在 constitution.allowed_permissions 內。
 */
export function safetyStrategy(_chief: Chief, ctx: ChiefDecisionContext): ChiefProposal[] {
  const proposals: ChiefProposal[] = [];
  const { state } = ctx;
  const constitution = state.constitution;
  if (!constitution) return proposals;

  const allowed = new Set(constitution.allowed_permissions);

  for (const c of state.chiefs) {
    const invalid = c.permissions.filter(p => !allowed.has(p));
    if (invalid.length > 0) {
      // 移除違規權限
      const validPerms = c.permissions.filter(p => allowed.has(p));
      proposals.push({
        change: {
          type: 'chief.update_permissions',
          chief_id: c.id,
          permissions: validPerms,
        },
        reason: `Chief "${c.name}" has unauthorized permissions [${invalid.join(', ')}] violating THY-09. Removing invalid permissions.`,
        confidence: 0.9,
        trigger: `chief=${c.id}, invalid_permissions=[${invalid.join(', ')}]`,
      });
    }
  }

  return proposals;
}

/**
 * Lore 策略：偵測不一致性（village 缺少描述、chief 無 constraints）。
 * 產生 village.update 或回傳空陣列。
 */
export function loreStrategy(_chief: Chief, ctx: ChiefDecisionContext): ChiefProposal[] {
  const { state } = ctx;
  const proposals: ChiefProposal[] = [];
  const flags: string[] = [];

  // 檢查 village 描述是否為空
  if (!state.village.description || state.village.description.trim() === '') {
    flags.push('village_missing_description');
  }

  // 檢查有無 chief 缺少 constraints
  const chiefsWithoutConstraints = state.chiefs.filter(c => c.constraints.length === 0);
  if (chiefsWithoutConstraints.length > 0) {
    flags.push(`chiefs_without_constraints: ${chiefsWithoutConstraints.map(c => c.name).join(', ')}`);
  }

  if (flags.length > 0) {
    proposals.push({
      change: {
        type: 'village.update',
        metadata: {
          ...(state.village.metadata as unknown as Record<string, unknown>),
          lore_flags: flags,
          lore_flagged_at: new Date().toISOString(),
        },
      },
      reason: `Lore inconsistencies detected: ${flags.join('; ')}`,
      confidence: 0.4,
      trigger: `flags=[${flags.join(', ')}]`,
    });
  }

  return proposals;
}

/**
 * Growth 策略：分析 skill 覆蓋率與 law 效果。
 * 觸發條件：skills < chiefs（缺 skill），或有 harmful 的 active law。
 */
export function growthStrategy(chief: Chief, ctx: ChiefDecisionContext): ChiefProposal[] {
  const { state, precedents } = ctx;
  const proposals: ChiefProposal[] = [];

  // 偵測 harmful 的 active law
  const harmfulLaws = state.active_laws.filter(
    l => l.effectiveness !== null && l.effectiveness.verdict === 'harmful',
  );
  if (harmfulLaws.length > 0) {
    const confidence = adjustConfidenceWithPrecedents(0.5, 'improvement', precedents);
    proposals.push({
      change: {
        type: 'law.propose',
        proposed_by: chief.id,
        category: 'improvement',
        content: {
          description: `Strategy improvement to address ${harmfulLaws.length} harmful law(s)`,
          strategy: {
            auto_generated: true,
            harmful_law_ids: harmfulLaws.map(l => l.id),
            action: 'review_and_replace',
          },
        },
        risk_level: 'low',
      },
      reason: `${harmfulLaws.length} active law(s) marked as harmful: [${harmfulLaws.map(l => l.id).join(', ')}]. Proposing improvement strategy.`,
      confidence,
      trigger: `harmful_active_laws=${harmfulLaws.length}`,
    });
  }

  // 偵測 skill 缺口
  if (state.chiefs.length > 0 && state.skills.length < state.chiefs.length) {
    proposals.push({
      change: {
        type: 'law.propose',
        proposed_by: chief.id,
        category: 'capability',
        content: {
          description: `Skill gap detected: ${state.chiefs.length} chiefs but only ${state.skills.length} skills available`,
          strategy: {
            auto_generated: true,
            action: 'expand_skill_coverage',
            current_skills: state.skills.length,
            current_chiefs: state.chiefs.length,
          },
        },
        risk_level: 'low',
      },
      reason: `Skill coverage gap: ${state.skills.length} skills for ${state.chiefs.length} chiefs. Proposing capability expansion.`,
      confidence: 0.5,
      trigger: `skills=${state.skills.length}, chiefs=${state.chiefs.length}`,
    });
  }

  return proposals;
}

// ---------------------------------------------------------------------------
// 優先級排序（#200: inter-chief coordination）
// ---------------------------------------------------------------------------

/** Chief 執行優先級映射（數字越小越先執行）。
 *  Safety(1) > Economy(2) > Lore(3) > Event(4) > Growth(5) */
export const CHIEF_PRIORITY: Readonly<Record<string, number>> = {
  safety: 1, security: 1, compliance: 1,
  economy: 2, budget: 2, finance: 2,
  lore: 3, narrative: 3, story: 3,
  event: 4, activity: 4,
  growth: 5, metrics: 5, analytics: 5,
};

/** 未知角色的預設優先級（最後執行） */
export const DEFAULT_PRIORITY = 99;

/**
 * 解析 chief role 對應的執行優先級。
 * 使用 keyword matching，與 resolveStrategy 一致。
 * 未知角色回傳 DEFAULT_PRIORITY。
 */
export function resolveChiefPriority(chief: Chief): number {
  const roleLower = chief.role.toLowerCase();
  for (const [keyword, priority] of Object.entries(CHIEF_PRIORITY)) {
    if (roleLower.includes(keyword)) return priority;
  }
  return DEFAULT_PRIORITY;
}

/**
 * 按優先級排序 chiefs（穩定排序）。
 * 同優先級按 created_at 升序（先建立的先執行）。
 * 回傳新陣列，不修改原陣列。
 */
export function sortChiefsByPriority(chiefs: Chief[]): Chief[] {
  return [...chiefs].sort((a, b) => {
    const pa = resolveChiefPriority(a);
    const pb = resolveChiefPriority(b);
    if (pa !== pb) return pa - pb;
    return a.created_at.localeCompare(b.created_at);
  });
}

// ---------------------------------------------------------------------------
// 角色解析
// ---------------------------------------------------------------------------

/** 角色關鍵字 → 策略映射（按順序匹配第一個） */
const ROLE_KEYWORDS: readonly [string, ChiefStrategy][] = [
  ['economy', economyStrategy],
  ['budget', economyStrategy],
  ['finance', economyStrategy],
  ['event', eventStrategy],
  ['activity', eventStrategy],
  ['safety', safetyStrategy],
  ['security', safetyStrategy],
  ['compliance', safetyStrategy],
  ['lore', loreStrategy],
  ['narrative', loreStrategy],
  ['story', loreStrategy],
  ['growth', growthStrategy],
  ['metrics', growthStrategy],
  ['analytics', growthStrategy],
];

/**
 * 解析 chief role 對應的決策策略。
 * 使用 keyword matching，case-insensitive。
 * 未知角色回傳 null（不會產生自主提案）。
 */
export function resolveStrategy(chief: Chief): ChiefStrategy | null {
  const roleLower = chief.role.toLowerCase();
  for (const [keyword, strategy] of ROLE_KEYWORDS) {
    if (roleLower.includes(keyword)) return strategy;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Personality 信心度過濾
// ---------------------------------------------------------------------------

/**
 * 根據 chief personality 的 risk_tolerance 決定是否提出提案。
 * conservative = 0.7 閾值, moderate = 0.5, aggressive = 0.3。
 */
export function shouldPropose(proposal: ChiefProposal, chief: Chief): boolean {
  const thresholds: Record<string, number> = {
    conservative: 0.7,
    moderate: 0.5,
    aggressive: 0.3,
  };
  const threshold = thresholds[chief.personality.risk_tolerance] ?? 0.5;
  return proposal.confidence >= threshold;
}

// ---------------------------------------------------------------------------
// 核心函數
// ---------------------------------------------------------------------------

/**
 * 根據 chief 的 role 觀察 WorldState，產生過濾後的 proposals。
 *
 * 流程：
 *   1. resolveStrategy → 取得策略函數
 *   2. strategy(chief, state) → 原始 proposals
 *   3. shouldPropose 過濾 → 最終 proposals
 *
 * Pure function，不寫 DB。
 */
export function makeChiefDecision(chief: Chief, state: WorldState, precedents?: EddaDecisionHit[]): ChiefProposal[] {
  const strategy = resolveStrategy(chief);
  if (!strategy) return [];

  const ctx: ChiefDecisionContext = { state, precedents: precedents ?? [] };
  const rawProposals = strategy(chief, ctx);
  return rawProposals.filter(p => shouldPropose(p, chief));
}

/**
 * 執行一輪 chief 決策週期（使用提供的 state 而非從 DB 讀取）。
 * 用於 coordinated execution：前一個 chief 的 state_after 作為下一個 chief 的輸入。
 */
export function executeChiefCycleWithState(
  worldManager: WorldManager,
  villageId: string,
  chief: Chief,
  state: WorldState,
  precedents?: EddaDecisionHit[],
): ChiefCycleResult {
  if (chief.status !== 'active') {
    return { chief_id: chief.id, proposals: [], applied: [], skipped: [] };
  }

  // #214: Workers do not participate in governance cycles (safety net)
  if (chief.role_type === 'worker') {
    return { chief_id: chief.id, proposals: [], applied: [], skipped: [] };
  }

  const proposals = makeChiefDecision(chief, state, precedents);
  const applied: ApplyResult[] = [];
  const skipped: { proposal: ChiefProposal; reason: string }[] = [];

  for (const proposal of proposals) {
    const result = worldManager.apply(villageId, proposal.change, proposal.reason);
    if (result.applied) {
      applied.push(result);
    } else {
      skipped.push({
        proposal,
        reason: result.judge_result.reasons.join('; '),
      });
    }
  }

  return { chief_id: chief.id, proposals, applied, skipped };
}

/**
 * 執行一輪 chief 決策週期。
 *
 * 流程：
 *   1. 取得 WorldState
 *   2. makeChiefDecision → proposals
 *   3. 逐一 apply（經 judge pipeline）
 *   4. 回傳 ChiefCycleResult
 *
 * 注意：inactive chief 不會執行。
 */
export function executeChiefCycle(
  worldManager: WorldManager,
  villageId: string,
  chief: Chief,
): ChiefCycleResult {
  if (chief.status !== 'active') {
    return { chief_id: chief.id, proposals: [], applied: [], skipped: [] };
  }
  const state = worldManager.getState(villageId);
  return executeChiefCycleWithState(worldManager, villageId, chief, state);
}

/** Coordinated cycle 結果 */
export interface CoordinatedCycleResult {
  /** 執行順序（chief IDs） */
  execution_order: string[];
  /** 各 chief 的結果 */
  chief_results: ChiefCycleResult[];
  /** 總共有多少次 state transition */
  state_transitions: number;
  /** Per-chief 錯誤（isolated，不影響其他 chief） */
  errors: { chief_id: string; error: string }[];
}

/**
 * 執行一輪多 chief 協調決策。
 * 1. 按 priority 排序 chiefs
 * 2. 首個 chief 用 DB state，後續 chief 用前一個的 state_after
 * 3. Judge 自然解決衝突（先到先得）
 * 4. Per-chief error isolation — 單一 chief 失敗不影響其他 chief
 */
export function executeCoordinatedCycle(
  worldManager: WorldManager,
  villageId: string,
  chiefs: Chief[],
  precedentsMap?: Map<string, EddaDecisionHit[]>,
): CoordinatedCycleResult {
  const sorted = sortChiefsByPriority(chiefs);
  let currentState = worldManager.getState(villageId);

  const results: ChiefCycleResult[] = [];
  const errors: { chief_id: string; error: string }[] = [];
  let stateTransitions = 0;

  for (const chief of sorted) {
    try {
      const chiefPrecedents = precedentsMap?.get(chief.id);
      const result = executeChiefCycleWithState(worldManager, villageId, chief, currentState, chiefPrecedents);
      results.push(result);

      // Thread state: use the last successful apply's state_after
      for (const applied of result.applied) {
        if (applied.state_after) {
          currentState = applied.state_after;
          stateTransitions++;
        }
      }
    } catch (err: unknown) {
      // Per-chief error isolation: one chief failing doesn't block others
      const message = err instanceof Error ? err.message : 'unknown';
      errors.push({ chief_id: chief.id, error: message });
      // Push empty result so chief_results stays aligned with execution_order
      results.push({ chief_id: chief.id, proposals: [], applied: [], skipped: [] });
    }
  }

  return {
    execution_order: sorted.map(c => c.id),
    chief_results: results,
    state_transitions: stateTransitions,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Edda 先例信心度調整（#222）
// ---------------------------------------------------------------------------

/**
 * 根據 Edda 先例調整信心度。
 *
 * 規則（簡單 rule-based，Phase 1）：
 * - 有相關 domain 的 active 先例 → +0.1（過去做過類似決策且仍有效）
 * - 有相關 domain 的 superseded 先例 → -0.05（過去做過但已被取代）
 * - 無先例 → 不調整
 *
 * 結果 clamped 到 [0, 1]。
 */
export function adjustConfidenceWithPrecedents(
  baseConfidence: number,
  domain: string,
  precedents: EddaDecisionHit[],
): number {
  if (precedents.length === 0) return baseConfidence;

  const domainLower = domain.toLowerCase();
  const relevant = precedents.filter(p => p.domain.toLowerCase().includes(domainLower));
  if (relevant.length === 0) return baseConfidence;

  const activeCount = relevant.filter(p => p.is_active).length;
  const supersededCount = relevant.length - activeCount;

  let adjusted = baseConfidence;
  adjusted += activeCount * 0.1;
  adjusted -= supersededCount * 0.05;

  return Math.max(0, Math.min(1, adjusted));
}

/**
 * 為多個 chiefs 批量預取 Edda 先例。
 *
 * 只查詢 use_precedents=true 的 chiefs。
 * Per-chief graceful degradation：單一 chief 查詢失敗不影響其他 chief。
 * Client-side lookback_days 過濾（Edda API 不支援日期範圍）。
 */
export async function prefetchPrecedents(
  eddaBridge: EddaBridge,
  chiefs: Chief[],
): Promise<Map<string, EddaDecisionHit[]>> {
  const result = new Map<string, EddaDecisionHit[]>();

  for (const chief of chiefs) {
    if (!chief.use_precedents) continue;

    const config: PrecedentConfig = chief.precedent_config ?? { max_precedents: 3, lookback_days: 30 };

    try {
      const queryResult = await eddaBridge.queryDecisions({
        domain: config.domain_filter,
        limit: config.max_precedents,
      });

      // Client-side lookback_days 過濾
      const cutoff = new Date(Date.now() - config.lookback_days * 24 * 60 * 60 * 1000).toISOString();
      const filtered = queryResult.decisions.filter(d => d.ts >= cutoff);

      result.set(chief.id, filtered);
    } catch {
      // Per-chief graceful degradation: Edda 查詢失敗 → 空先例
      result.set(chief.id, []);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Pipeline Dispatch（Karvi 整合 — #212）
// ---------------------------------------------------------------------------

/** 單一 pipeline dispatch 結果 */
export interface PipelineDispatchResult {
  chief_id: string;
  village_id: string;
  pipeline_id: string;
  dispatched: boolean;
  project_response: KarviProjectResponse | null;
  error?: string;
}

/**
 * 將 chief 的 pipelines 派發到 Karvi 執行。
 *
 * 每個 pipeline_id 對應一個 Karvi project（single-task），
 * task.skill = pipeline_id。Karvi 側負責解析 pipeline 並執行。
 *
 * Graceful degradation（THY-06）：Karvi 離線時 dispatched=false，
 * 不 throw，不 fallback 到 local rule-based（pipeline 邏輯不同）。
 */
export async function dispatchChiefPipelines(
  karviBridge: KarviBridge,
  villageId: string,
  chief: Chief,
): Promise<PipelineDispatchResult[]> {
  const results: PipelineDispatchResult[] = [];

  for (const pipelineId of chief.pipelines) {
    const taskId = `${villageId}:${chief.id}:${pipelineId}:${Date.now()}`;
    try {
      const response = await karviBridge.dispatchProject({
        title: `${chief.name}:pipeline:${pipelineId}`,
        tasks: [{
          id: taskId,
          skill: pipelineId,
          description: `Pipeline execution for chief "${chief.name}" in village ${villageId}`,
        }],
        goal: `Chief ${chief.name} autonomous governance cycle`,
        autoStart: true,
      });

      results.push({
        chief_id: chief.id,
        village_id: villageId,
        pipeline_id: pipelineId,
        dispatched: response !== null,
        project_response: response,
        error: response === null ? 'Karvi unreachable' : undefined,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown';
      results.push({
        chief_id: chief.id,
        village_id: villageId,
        pipeline_id: pipelineId,
        dispatched: false,
        project_response: null,
        error: message,
      });
    }
  }

  return results;
}
