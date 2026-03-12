import type { Database } from 'bun:sqlite';
import type { ConstitutionStore, Constitution } from './constitution-store';
import type { ChiefEngine, Chief } from './chief-engine';
import type { LawEngine, Law } from './law-engine';
import type { SkillRegistry, Skill } from './skill-registry';
import type { EddaBridge, EddaDecisionHit } from './edda-bridge';
import type { RiskAssessor } from './risk-assessor';
import type { LoopAction } from './schemas/loop';

// Re-export CycleIntent from schemas/loop (single source of truth)
export type { CycleIntent } from './schemas/loop';
import type { CycleIntent } from './schemas/loop';

// ---------------------------------------------------------------------------
// 型別定義 — aligned with DECISION_ENGINE_V01.md Section 2
// ---------------------------------------------------------------------------

/** 預算狀態快照 */
export interface BudgetSnapshot {
  per_action_limit: number;
  per_day_limit: number;
  per_loop_limit: number;
  spent_today: number;
  spent_this_loop: number;
}

/** 結構化上下文 — buildContext() 的輸出（v0.1 Section 2.1） */
export interface DecideContext {
  // 基本識別
  cycle_id: string;
  village_id: string;
  iteration: number;
  max_iterations: number;

  // 預算（結構化）
  budget: BudgetSnapshot;
  budget_ratio: number;              // remaining / total, 0-1

  // 從 actions[] 推導
  last_action: LoopAction | null;
  completed_action_types: string[];
  pending_approvals: number;
  blocked_count: number;

  // 從 audit_log 查詢
  recent_rollbacks: number;          // 最近 24h 內 law rollback 數量

  // 從 Edda 查詢（graceful degradation）
  edda_precedents: EddaDecisionHit[];
  edda_available: boolean;

  // 直接傳入 / 查詢
  chief: Chief;
  chief_skills: Skill[];
  constitution: Constitution;
  active_laws: Law[];
  observations: Record<string, unknown>[];

  // 意圖狀態（從 loop_cycles.intent 讀取）
  intent: CycleIntent | null;
}

/** 推理因素 */
export interface ReasoningFactor {
  source: 'constitution' | 'law' | 'precedent' | 'observation' | 'budget' | 'chief_constraint';
  description: string;
  weight: 'high' | 'medium' | 'low';
}

/** 推理鏈 — v0.1 Section 2.4 (SI-2: 所有決策必須有可追溯的理由鏈) */
export interface DecisionReasoning {
  summary: string;
  factors: string[];
  precedent_notes: string[];
  law_considerations: string[];
  personality_effect: string;
  confidence: number; // 0–1
}

/** 法律提案草案 — v0.1 Section 2.3 */
export interface LawProposalDraft {
  category: string;
  content: { description: string; strategy: Record<string, unknown> };
  evidence: { source: string; reasoning: string; edda_refs: string[] };
  trigger: string;
}

/** 行動意圖 — v0.1 Section 2.2 */
export interface ActionIntent {
  kind: 'dispatch_task' | 'propose_law' | 'request_approval' | 'wait' | 'complete_cycle';
  task_key?: string;                    // 對應 SkillRegistry 的 skill name
  payload?: Record<string, unknown>;
  estimated_cost: number;
  rollback_plan: string;
  reason: string;
  evidence_refs: string[];              // edda event_id 列表
  confidence: number;                   // 0-1
}

/** 循環結果摘要 — v0.1 Section 2.1 */
export interface LoopOutcome {
  cycle_id: string;
  status: 'completed' | 'timeout' | 'aborted';
  actions_executed: number;
  cost_incurred: number;
}

/** 決策結果 — v0.1 Section 2.5 */
export interface DecideResult {
  action: ActionIntent | null;
  law_proposals: LawProposalDraft[];
  reasoning: DecisionReasoning;
  updated_intent: CycleIntent | null;
}

/** buildContext 的循環狀態參數 */
export interface CycleState {
  cycle_id: string;
  iteration: number;
  max_iterations: number;
  loop_id?: string;
  actions?: LoopAction[];
  intent?: CycleIntent | null;
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
   * 組裝結構化決策上下文（v0.1 Section 4.1）。
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
    let eddaPrecedents: EddaDecisionHit[] = [];
    let eddaAvailable = false;
    if (this.eddaBridge) {
      try {
        const result = await this.eddaBridge.queryDecisions({
          domain: villageId,
          limit: 10,
        });
        eddaPrecedents = result.decisions;
        eddaAvailable = true;
      } catch {
        // Edda offline → 空結果，不 crash
      }
    }

    // 組裝預算快照
    const spentToday = this.riskAssessor.getSpentToday(villageId);
    const spentThisLoop = cycleState.loop_id
      ? this.riskAssessor.getSpentInLoop(villageId, cycleState.loop_id)
      : 0;
    const budget: BudgetSnapshot = {
      per_action_limit: constitution.budget_limits.max_cost_per_action,
      per_day_limit: constitution.budget_limits.max_cost_per_day,
      per_loop_limit: constitution.budget_limits.max_cost_per_loop,
      spent_today: spentToday,
      spent_this_loop: spentThisLoop,
    };
    const budgetTotal = budget.per_day_limit;
    const budgetRemaining = Math.max(0, budgetTotal - spentToday);
    const budgetRatio = budgetTotal > 0 ? budgetRemaining / budgetTotal : 0;

    // 從 actions 推導統計
    const actions = cycleState.actions ?? [];
    const lastAction = actions.length > 0 ? actions[actions.length - 1] : null;
    const completedActionTypes = actions
      .filter(a => a.status === 'executed')
      .map(a => a.type);
    const pendingApprovals = actions.filter(a => a.status === 'pending_approval').length;
    const blockedCount = actions.filter(a => a.status === 'blocked').length;

    // 查詢最近 24h 的 law rollback 數量
    const recentRollbacks = this.countRecentRollbacks(villageId);

    return {
      cycle_id: cycleState.cycle_id,
      village_id: villageId,
      iteration: cycleState.iteration,
      max_iterations: cycleState.max_iterations,
      budget,
      budget_ratio: budgetRatio,
      last_action: lastAction,
      completed_action_types: completedActionTypes,
      pending_approvals: pendingApprovals,
      blocked_count: blockedCount,
      recent_rollbacks: recentRollbacks,
      edda_precedents: eddaPrecedents,
      edda_available: eddaAvailable,
      chief,
      chief_skills: chiefSkills,
      constitution,
      active_laws: activeLaws,
      observations,
      intent: cycleState.intent ?? null,
    };
  }

  /**
   * Phase 0: 規則式決策 — 永遠 return action: null。
   * 與 LoopRunner 現有的 decide() 行為等價。
   *
   * Phase 1 會替換成 rule-based 四層決策。
   */
  decide(context: DecideContext): DecideResult {
    const factors: string[] = [];
    const lawConsiderations: string[] = [];
    const precedentNotes: string[] = [];

    // 憲法約束
    factors.push(`Active constitution v${context.constitution.version} with ${context.constitution.rules.length} rules`);

    // 活躍法律
    if (context.active_laws.length > 0) {
      factors.push(`${context.active_laws.length} active law(s) in effect`);
      for (const law of context.active_laws) {
        lawConsiderations.push(`${law.category}: ${law.content.description}`);
      }
    }

    // 觀測資料
    if (context.observations.length > 0) {
      factors.push(`${context.observations.length} observation(s) collected`);
    }

    // 歷史決策
    if (context.edda_precedents.length > 0) {
      factors.push(`${context.edda_precedents.length} precedent(s) from Edda`);
      for (const p of context.edda_precedents) {
        precedentNotes.push(`${p.key}: ${p.value}${p.is_active ? '' : ' (superseded)'}`);
      }
    }

    // 預算狀態
    const budgetUsedPct = Math.round((1 - context.budget_ratio) * 100);
    factors.push(`Daily budget ${budgetUsedPct}% used (${context.budget.spent_today}/${context.budget.per_day_limit})`);

    // Chief 約束
    let personalityEffect = `Chief ${context.chief.name} (${context.chief.role})`;
    const constraintDescs: string[] = [];
    for (const constraint of context.chief.constraints) {
      constraintDescs.push(`${constraint.type}: ${constraint.description}`);
    }
    if (constraintDescs.length > 0) {
      personalityEffect += ` — constraints: ${constraintDescs.join('; ')}`;
    }

    // Phase 0: 永遠不採取行動
    const reasoning: DecisionReasoning = {
      summary: 'Phase 0: no autonomous action taken. Context assembled for future decision-making.',
      factors,
      precedent_notes: precedentNotes,
      law_considerations: lawConsiderations,
      personality_effect: personalityEffect,
      confidence: 1.0,
    };

    return {
      action: null,
      law_proposals: [],
      reasoning,
      updated_intent: null,
    };
  }

  /** 查詢最近 24h 內的 law rollback 數量 */
  private countRecentRollbacks(villageId: string): number {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const row = this.db.prepare(`
      SELECT COUNT(*) as cnt FROM audit_log
      WHERE entity_type = 'law' AND action = 'rollback'
        AND payload LIKE ? AND created_at > ?
    `).get(`%${villageId}%`, since) as { cnt: number } | null;
    return row?.cnt ?? 0;
  }

  /** 格式化 LoopOutcome 摘要 */
  static summarizeOutcome(outcome: LoopOutcome): string {
    return `Cycle ${outcome.cycle_id} [${outcome.status}] — Actions: ${outcome.actions_executed}, Cost: ${outcome.cost_incurred}`;
  }
}
