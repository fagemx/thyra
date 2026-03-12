import type { Database } from 'bun:sqlite';
import type { ConstitutionStore, Constitution } from './constitution-store';
import type { ChiefEngine, Chief } from './chief-engine';
import type { LawEngine, Law } from './law-engine';
import type { SkillRegistry, Skill } from './skill-registry';
import type { EddaBridge, EddaDecisionHit } from './edda-bridge';
import type { RiskAssessor } from './risk-assessor';

// ---------------------------------------------------------------------------
// 型別定義
// ---------------------------------------------------------------------------

/** 預算狀態快照 */
export interface BudgetSnapshot {
  per_action_limit: number;
  per_day_limit: number;
  per_loop_limit: number;
  spent_today: number;
  spent_this_loop: number;
}

/** 結構化上下文 — buildContext() 的輸出 */
export interface DecideContext {
  village_id: string;
  chief: Chief;
  constitution: Constitution;
  active_laws: Law[];
  chief_skills: Skill[];
  observations: Record<string, unknown>[];
  precedents: EddaDecisionHit[];
  budget: BudgetSnapshot;
  cycle_iteration: number;
  max_iterations: number;
}

/** 推理因素 */
export interface ReasoningFactor {
  source: 'constitution' | 'law' | 'precedent' | 'observation' | 'budget' | 'chief_constraint';
  description: string;
  weight: 'high' | 'medium' | 'low';
}

/** 推理鏈 (SI-2: 所有決策必須有可追溯的理由鏈) */
export interface DecisionReasoning {
  factors: ReasoningFactor[];
  conclusion: string;
  confidence: number; // 0–1
}

/** 法律提案草案 — DecisionEngine 建議，LoopRunner 執行 */
export interface LawProposalDraft {
  category: string;
  content: { description: string; strategy: Record<string, unknown> };
  evidence: { source: string; reasoning: string; edda_refs?: string[] };
  risk_level: 'low' | 'medium' | 'high';
}

/** 行動意圖 — 比 LoopRunner.Decision 更豐富的決策輸出 */
export interface ActionIntent {
  type: string;
  description: string;
  estimated_cost: number;
  reason: string;
  rollback_plan: string;
  law_proposal: LawProposalDraft | null;
  metadata: Record<string, unknown>;
}

/** 循環意圖 — 建議 LoopRunner 繼續或停止 */
export interface CycleIntent {
  should_continue: boolean;
  reason: string;
}

/** 循環結果 — 供未來 LoopRunner 使用 */
export interface LoopOutcome {
  cycle_id: string;
  village_id: string;
  total_actions: number;
  total_cost: number;
  laws_proposed: string[];
  laws_enacted: string[];
  final_status: 'completed' | 'timeout' | 'aborted';
  reasoning_summary: string;
}

/** 決策結果 — decide() 的回傳值 */
export interface DecideResult {
  action: ActionIntent | null;
  reasoning: DecisionReasoning;
  cycle_intent: CycleIntent;
}

/** buildContext 的循環狀態參數 */
export interface CycleState {
  iteration: number;
  max_iterations: number;
  loop_id?: string;
}

// ---------------------------------------------------------------------------
// DecisionEngine class
// ---------------------------------------------------------------------------

/**
 * DecisionEngine — 純查詢 + 計算，不直接修改 DB 狀態。
 *
 * 職責：
 * 1. buildContext(): 從各模組收集決策所需上下文
 * 2. decide(): 根據上下文產生決策結果
 *
 * Phase 0: decide() 永遠 return action: null（與 LoopRunner 現有行為等價）
 * Phase 1: 將接入 LLM-based 決策
 */
export class DecisionEngine {
  constructor(
    private db: Database,
    private constitutionStore: ConstitutionStore,
    private chiefEngine: ChiefEngine,
    private lawEngine: LawEngine,
    private skillRegistry: SkillRegistry,
    private riskAssessor: RiskAssessor,
    private eddaBridge: EddaBridge | null,
  ) {}

  /**
   * 組裝結構化決策上下文。
   * 從 ConstitutionStore、ChiefEngine、LawEngine、SkillRegistry、EddaBridge 收集資訊。
   */
  async buildContext(
    villageId: string,
    chiefId: string,
    observations: Record<string, unknown>[],
    cycleState: CycleState,
  ): Promise<DecideContext> {
    // 查詢活躍憲法
    const constitution = this.constitutionStore.getActive(villageId);
    if (!constitution) {
      throw new Error('No active constitution for village');
    }

    // 查詢 chief
    const chief = this.chiefEngine.get(chiefId);
    if (!chief) {
      throw new Error('Chief not found');
    }
    if (chief.village_id !== villageId) {
      throw new Error('Chief does not belong to this village');
    }

    // 查詢活躍法律
    const activeLaws = this.lawEngine.getActiveLaws(villageId);

    // 查詢 chief 綁定的 skills
    const chiefSkills: Skill[] = [];
    for (const binding of chief.skills) {
      const skill = this.skillRegistry.get(binding.skill_id);
      if (skill) {
        chiefSkills.push(skill);
      }
    }

    // 查詢 Edda 歷史決策（optional，graceful degradation）
    let precedents: EddaDecisionHit[] = [];
    if (this.eddaBridge) {
      try {
        const result = await this.eddaBridge.queryDecisions({
          domain: villageId,
          limit: 10,
        });
        precedents = result.decisions;
      } catch {
        // Edda offline → 空結果，不 crash
        precedents = [];
      }
    }

    // 組裝預算快照
    const budget: BudgetSnapshot = {
      per_action_limit: constitution.budget_limits.max_cost_per_action,
      per_day_limit: constitution.budget_limits.max_cost_per_day,
      per_loop_limit: constitution.budget_limits.max_cost_per_loop,
      spent_today: this.riskAssessor.getSpentToday(villageId),
      spent_this_loop: cycleState.loop_id
        ? this.riskAssessor.getSpentInLoop(villageId, cycleState.loop_id)
        : 0,
    };

    return {
      village_id: villageId,
      chief,
      constitution,
      active_laws: activeLaws,
      chief_skills: chiefSkills,
      observations,
      precedents,
      budget,
      cycle_iteration: cycleState.iteration,
      max_iterations: cycleState.max_iterations,
    };
  }

  /**
   * Phase 0: 規則式決策 — 永遠 return action: null。
   * 與 LoopRunner 現有的 decide() 行為等價。
   *
   * Phase 1 會替換成 LLM-based 決策。
   */
  decide(context: DecideContext): DecideResult {
    const factors: ReasoningFactor[] = [];

    // 收集推理因素

    // 憲法約束
    factors.push({
      source: 'constitution',
      description: `Active constitution v${context.constitution.version} with ${context.constitution.rules.length} rules`,
      weight: 'high',
    });

    // 活躍法律
    if (context.active_laws.length > 0) {
      factors.push({
        source: 'law',
        description: `${context.active_laws.length} active law(s) in effect`,
        weight: 'medium',
      });
    }

    // 觀測資料
    if (context.observations.length > 0) {
      factors.push({
        source: 'observation',
        description: `${context.observations.length} observation(s) collected`,
        weight: 'medium',
      });
    }

    // 歷史決策
    if (context.precedents.length > 0) {
      factors.push({
        source: 'precedent',
        description: `${context.precedents.length} precedent(s) from Edda`,
        weight: 'low',
      });
    }

    // 預算狀態
    const budgetUsedPct = context.budget.per_day_limit > 0
      ? context.budget.spent_today / context.budget.per_day_limit
      : 0;
    factors.push({
      source: 'budget',
      description: `Daily budget ${Math.round(budgetUsedPct * 100)}% used (${context.budget.spent_today}/${context.budget.per_day_limit})`,
      weight: budgetUsedPct > 0.8 ? 'high' : 'low',
    });

    // Chief 約束
    for (const constraint of context.chief.constraints) {
      factors.push({
        source: 'chief_constraint',
        description: `${constraint.type}: ${constraint.description}`,
        weight: constraint.type === 'must' || constraint.type === 'must_not' ? 'high' : 'low',
      });
    }

    // Phase 0: 永遠不採取行動
    const reasoning: DecisionReasoning = {
      factors,
      conclusion: 'Phase 0: no autonomous action taken. Context assembled for future decision-making.',
      confidence: 1.0,
    };

    const cycleIntent: CycleIntent = {
      should_continue: false,
      reason: 'Phase 0 decision engine does not generate actions',
    };

    return {
      action: null,
      reasoning,
      cycle_intent: cycleIntent,
    };
  }

  /**
   * 格式化 LoopOutcome 摘要
   */
  static summarizeOutcome(outcome: LoopOutcome): string {
    const lines: string[] = [
      `Cycle ${outcome.cycle_id} [${outcome.final_status}]`,
      `Village: ${outcome.village_id}`,
      `Actions: ${outcome.total_actions}, Cost: ${outcome.total_cost}`,
    ];

    if (outcome.laws_proposed.length > 0) {
      lines.push(`Laws proposed: ${outcome.laws_proposed.join(', ')}`);
    }
    if (outcome.laws_enacted.length > 0) {
      lines.push(`Laws enacted: ${outcome.laws_enacted.join(', ')}`);
    }
    if (outcome.reasoning_summary) {
      lines.push(`Summary: ${outcome.reasoning_summary}`);
    }

    return lines.join('\n');
  }
}
