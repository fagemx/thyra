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
import type { WorldManager, ApplyResult } from './world-manager';
import type { KarviBridge, KarviProjectResponse } from './karvi-bridge';
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

/** 策略函數類型 -- pure function，無副作用 */
export type ChiefStrategy = (chief: Chief, state: WorldState) => ChiefProposal[];

// ---------------------------------------------------------------------------
// 角色策略實作
// ---------------------------------------------------------------------------

/**
 * Economy 策略：監控預算使用狀況。
 * 觸發條件：running_cycles > 0 且 constitution 有預算限制時，
 * 以 running cycles 數量作為高負載指標，提議調降預算。
 */
export function economyStrategy(_chief: Chief, state: WorldState): ChiefProposal[] {
  const proposals: ChiefProposal[] = [];
  const constitution = state.constitution;
  if (!constitution) return proposals;

  const runningCount = state.running_cycles.length;
  const limits = constitution.budget_limits;

  // 高活動量 + 預算存在 → 提議調降 per-action 預算 20%
  if (runningCount > 0 && limits.max_cost_per_action > 0) {
    const newLimit = Math.round(limits.max_cost_per_action * 0.8 * 100) / 100;
    proposals.push({
      change: {
        type: 'budget.adjust',
        max_cost_per_action: newLimit,
      },
      reason: `High activity detected: ${runningCount} running cycle(s). Reducing per-action budget by 20% to maintain fiscal discipline.`,
      confidence: 0.7,
      trigger: `running_cycles.length=${runningCount}, current max_cost_per_action=${limits.max_cost_per_action}`,
    });
  }

  return proposals;
}

/**
 * Event 策略：確保足夠的治理法規。
 * 觸發條件：active_laws < 3 → 提議新法。
 */
export function eventStrategy(chief: Chief, state: WorldState): ChiefProposal[] {
  const proposals: ChiefProposal[] = [];

  if (state.active_laws.length < 3) {
    // 找出是否缺少 governance 類法規
    const hasGovernance = state.active_laws.some(l => l.category === 'governance');
    const category = hasGovernance ? 'operational' : 'governance';

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
      confidence: 0.6,
      trigger: `active_laws.length=${state.active_laws.length}`,
    });
  }

  return proposals;
}

/**
 * Safety 策略：偵測 THY-09 權限違規。
 * 觸發條件：chief permissions 不在 constitution.allowed_permissions 內。
 */
export function safetyStrategy(_chief: Chief, state: WorldState): ChiefProposal[] {
  const proposals: ChiefProposal[] = [];
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
export function loreStrategy(_chief: Chief, state: WorldState): ChiefProposal[] {
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
export function growthStrategy(chief: Chief, state: WorldState): ChiefProposal[] {
  const proposals: ChiefProposal[] = [];

  // 偵測 harmful 的 active law
  const harmfulLaws = state.active_laws.filter(
    l => l.effectiveness !== null && l.effectiveness.verdict === 'harmful',
  );
  if (harmfulLaws.length > 0) {
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
      confidence: 0.5,
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
export function makeChiefDecision(chief: Chief, state: WorldState): ChiefProposal[] {
  const strategy = resolveStrategy(chief);
  if (!strategy) return [];

  const rawProposals = strategy(chief, state);
  return rawProposals.filter(p => shouldPropose(p, chief));
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
  // 前置檢查：chief 必須 active
  if (chief.status !== 'active') {
    return {
      chief_id: chief.id,
      proposals: [],
      applied: [],
      skipped: [],
    };
  }

  const state = worldManager.getState(villageId);
  const proposals = makeChiefDecision(chief, state);

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

  return {
    chief_id: chief.id,
    proposals,
    applied,
    skipped,
  };
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
