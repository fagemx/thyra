import type { Database } from 'bun:sqlite';
import { appendAudit } from './db';
import type { ConstitutionStore, Constitution } from './constitution-store';
import type { ChiefEngine, Chief } from './chief-engine';
import type { LawEngine, Law } from './law-engine';
import type { SkillRegistry, Skill } from './skill-registry';
import type { EddaBridge, EddaDecisionHit } from './edda-bridge';
import type { RiskAssessor } from './risk-assessor';
import type { LlmAdvisor } from './llm-advisor';
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
 * 2. decide(): 根據上下文產生決策結果（rule-based pipeline）
 *
 * Phase 1: rule-based 四層決策
 *   generateCandidates() → selectBest() → checkLawProposals()
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
    private llmAdvisor?: LlmAdvisor,
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

    // 從 actions 推導統計（先計算，Edda 查詢需要 lastAction.type）
    const actions = cycleState.actions ?? [];
    const lastAction = actions.length > 0 ? actions[actions.length - 1] : null;
    const completedActionTypes = actions
      .filter(a => a.status === 'executed')
      .map(a => a.type);
    const pendingApprovals = actions.filter(a => a.status === 'pending_approval').length;
    const blockedCount = actions.filter(a => a.status === 'blocked').length;

    // 查詢 Edda 歷史決策（optional，graceful degradation）
    // 使用 villageId + lastAction type 做更精確的查詢
    let eddaPrecedents: EddaDecisionHit[] = [];
    let eddaAvailable = false;
    if (this.eddaBridge) {
      try {
        const result = await this.eddaBridge.queryDecisions({
          domain: villageId,
          keyword: lastAction?.type,  // 查詢同類型 action 的歷史
          limit: 10,
        });
        // 過濾 superseded 決策 — 只保留 is_active=true 的最新決策
        eddaPrecedents = result.decisions.filter(d => d.is_active);
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
   * 決策引擎主流程。
   * 三步 pipeline: generateCandidates → selectBest → checkLawProposals
   * 如果有 LlmAdvisor，額外執行 LLM 重排 + 推理增強 + law 建議。
   * LLM 呼叫全部在 try/catch 內，失敗時 fallback 到 rule-based。
   */
  async decide(context: DecideContext): Promise<DecideResult> {
    // 組裝推理因素（SI-2: 所有決策必須有可追溯的理由鏈）
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

    // 歷史決策 — 分類為正面/負面，加入摘要
    if (context.edda_precedents.length > 0) {
      const activePrecedents = context.edda_precedents.filter(p => p.is_active);
      const positivePrecedents = activePrecedents.filter(p =>
        /effective|success/i.test(p.value),
      );
      const negativePrecedents = activePrecedents.filter(p =>
        /harmful|rollback|failed/i.test(p.value),
      );

      factors.push(`${context.edda_precedents.length} precedent(s) from Edda`);

      // 正面/負面摘要
      if (positivePrecedents.length > 0) {
        precedentNotes.push(`${positivePrecedents.length} positive precedent(s): ${positivePrecedents.map(p => p.key).join(', ')}`);
      }
      if (negativePrecedents.length > 0) {
        precedentNotes.push(`${negativePrecedents.length} negative precedent(s): ${negativePrecedents.map(p => p.key).join(', ')}`);
      }

      for (const p of context.edda_precedents) {
        precedentNotes.push(`${p.key}: ${p.value}${p.is_active ? '' : ' (superseded)'}`);
      }
    }

    // 預算狀態
    const budgetUsedPct = Math.round((1 - context.budget_ratio) * 100);
    factors.push(`Daily budget ${budgetUsedPct}% used (${context.budget.spent_today}/${context.budget.per_day_limit})`);

    // Chief personality + 約束
    let personalityEffect = `Chief ${context.chief.name} (${context.chief.role})`;
    const riskTolerance = context.chief.personality?.risk_tolerance ?? 'moderate';
    personalityEffect += ` [${riskTolerance}]`;
    const constraintDescs: string[] = [];
    for (const constraint of context.chief.constraints) {
      constraintDescs.push(`${constraint.type}: ${constraint.description}`);
    }
    if (constraintDescs.length > 0) {
      personalityEffect += ` — constraints: ${constraintDescs.join('; ')}`;
    }

    // --- Pipeline ---
    const candidates = this.generateCandidates(context);
    let action = this.selectBest(candidates, context);
    let lawProposals = this.checkLawProposals(context);

    // --- LLM Advisor 增強（可選） ---
    if (this.llmAdvisor) {
      // LLM 重排候選
      if (candidates.length > 0) {
        try {
          const advisorResult = await this.llmAdvisor.advise(context, candidates);
          if (advisorResult.selected_index >= 0 && advisorResult.selected_index < candidates.length) {
            action = candidates[advisorResult.selected_index];
            factors.push(`LLM advisor re-ranked: selected candidate ${advisorResult.selected_index}`);
          }
          if (advisorResult.overall_reasoning) {
            factors.push(`LLM advisor: ${advisorResult.overall_reasoning}`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          appendAudit(this.db, 'llm_advisor', context.cycle_id, 'advise_fallback', {
            error: msg.slice(0, 500),
          }, 'system');
        }
      }

      // LLM 推理增強
      try {
        const enrichment = await this.llmAdvisor.generateReasoning(context, action);
        if (enrichment.enriched_summary) {
          factors.push(`LLM reasoning: ${enrichment.enriched_summary}`);
        }
        if (enrichment.additional_factors.length > 0) {
          factors.push(...enrichment.additional_factors);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        appendAudit(this.db, 'llm_advisor', context.cycle_id, 'reasoning_fallback', {
          error: msg.slice(0, 500),
        }, 'system');
      }

      // LLM law proposal 建議
      try {
        const suggestions = await this.llmAdvisor.suggestLawProposals(context);
        if (suggestions.length > 0) {
          const llmProposals: import('./decision-engine').LawProposalDraft[] = suggestions.map(s => ({
            category: s.category,
            content: { description: s.description, strategy: s.strategy },
            evidence: {
              source: 'llm_advisor',
              reasoning: s.reasoning,
              edda_refs: [],
            },
            trigger: s.trigger,
          }));
          lawProposals = [...lawProposals, ...llmProposals];
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        appendAudit(this.db, 'llm_advisor', context.cycle_id, 'law_suggest_fallback', {
          error: msg.slice(0, 500),
        }, 'system');
      }
    }

    // 計算 confidence
    let confidence = action?.confidence ?? 1.0;

    // 人格影響 confidence
    if (action) {
      const adjustment = this.applyPersonalityConfidence(action, context, riskTolerance);
      confidence = Math.max(0, Math.min(1, confidence + adjustment));
      if (adjustment !== 0) {
        personalityEffect += ` — ${riskTolerance} adjustment: ${adjustment > 0 ? '+' : ''}${adjustment.toFixed(2)}`;
      }
    }

    // 組裝 updated_intent
    let updatedIntent: CycleIntent | null = null;
    if (action && action.kind === 'dispatch_task' && action.task_key) {
      updatedIntent = {
        goal_kind: context.intent?.goal_kind ?? 'content_pipeline',
        stage_hint: action.task_key,
        origin_reason: context.intent?.origin_reason ?? 'pipeline started by decision engine',
        last_decision_summary: action.reason,
      };
    }

    // 決策摘要
    let summary: string;
    if (!action) {
      summary = 'No action needed. Cycle completed — no active laws or intent to execute.';
    } else if (action.kind === 'complete_cycle') {
      summary = `Cycle completed: ${action.reason}`;
    } else if (action.kind === 'wait') {
      summary = `Waiting: ${action.reason}`;
    } else {
      summary = `Action: ${action.kind}${action.task_key ? `(${action.task_key})` : ''} — ${action.reason}`;
    }

    const finalAction = action ? { ...action, confidence } : null;

    const reasoning: DecisionReasoning = {
      summary,
      factors,
      precedent_notes: precedentNotes,
      law_considerations: lawConsiderations,
      personality_effect: personalityEffect,
      confidence,
    };

    return {
      action: finalAction,
      law_proposals: lawProposals,
      reasoning,
      updated_intent: updatedIntent,
    };
  }

  // ---------------------------------------------------------------------------
  // Pipeline Layer 2: generateCandidates — 6 條流水線規則
  // ---------------------------------------------------------------------------

  /**
   * 根據上下文產生候選 ActionIntent 列表。
   * 規則依優先順序評估（terminal rules 命中後直接回傳）。
   */
  private generateCandidates(ctx: DecideContext): ActionIntent[] {
    const eddaRefs = ctx.edda_precedents
      .filter(p => p.is_active)
      .map(p => p.event_id);

    // 規則 4: pending_approval > 0 → wait（不產生新 action，等人審）
    if (ctx.pending_approvals > 0) {
      return [{
        kind: 'wait',
        estimated_cost: 0,
        rollback_plan: 'none',
        reason: `${ctx.pending_approvals} action(s) pending human approval`,
        evidence_refs: eddaRefs,
        confidence: 1.0,
      }];
    }

    // 規則 5: budget_ratio < 0.1 → complete_cycle（預算不足）
    if (ctx.budget_ratio < 0.1) {
      return [{
        kind: 'complete_cycle',
        estimated_cost: 0,
        rollback_plan: 'none',
        reason: `Budget exhausted (${Math.round(ctx.budget_ratio * 100)}% remaining)`,
        evidence_refs: eddaRefs,
        confidence: 1.0,
      }];
    }

    // 規則 6: blocked_count >= 3 → complete_cycle（連續被擋）
    if (ctx.blocked_count >= 3) {
      return [{
        kind: 'complete_cycle',
        estimated_cost: 0,
        rollback_plan: 'none',
        reason: `Stuck: ${ctx.blocked_count} actions blocked`,
        evidence_refs: eddaRefs,
        confidence: 1.0,
      }];
    }

    // 規則 2: 有 intent → 根據 stage_hint 推進流水線
    if (ctx.intent) {
      return this.advancePipeline(ctx, eddaRefs);
    }

    // 規則 3: 沒有 intent 但有 active laws → 開始新流水線
    if (ctx.active_laws.length > 0) {
      return this.startPipeline(ctx, eddaRefs);
    }

    // 規則 1: 沒有 intent 且沒有 active laws → 空列表（action: null）
    return [];
  }

  /**
   * 規則 2: 根據 stage_hint 推進流水線到下一步。
   */
  private advancePipeline(ctx: DecideContext, eddaRefs: string[]): ActionIntent[] {
    const stage = ctx.intent!.stage_hint;
    const lastExecuted = ctx.last_action?.status === 'executed';

    // 流水線階段映射
    const stageMap: Record<string, string> = {
      'research': 'draft',
      'draft': 'review',
      'review': 'publish',
    };

    // 如果上一步已執行，推進到下一階段
    if (lastExecuted && stage in stageMap) {
      const nextStage = stageMap[stage];
      return this.buildDispatchCandidate(nextStage, ctx, eddaRefs,
        `Advancing pipeline: ${stage} completed, moving to ${nextStage}`);
    }

    // publish 完成 → complete_cycle
    if (lastExecuted && stage === 'publish') {
      return [{
        kind: 'complete_cycle',
        estimated_cost: 0,
        rollback_plan: 'none',
        reason: 'Pipeline completed: publish stage done',
        evidence_refs: eddaRefs,
        confidence: 1.0,
      }];
    }

    // 沒有 last_action 或沒有執行完成 → 繼續當前階段
    return this.buildDispatchCandidate(stage, ctx, eddaRefs,
      `Continuing pipeline at stage: ${stage}`);
  }

  /**
   * 規則 3: 開始新流水線（從 research 開始）。
   */
  private startPipeline(ctx: DecideContext, eddaRefs: string[]): ActionIntent[] {
    return this.buildDispatchCandidate('research', ctx, eddaRefs,
      `Starting new pipeline: ${ctx.active_laws.length} active law(s) to execute`);
  }

  /**
   * 建立 dispatch_task 候選，並用 SkillRegistry 驗證 task_key。
   * 如果找不到 verified skill → 回傳空列表。
   */
  private buildDispatchCandidate(
    taskKey: string,
    ctx: DecideContext,
    eddaRefs: string[],
    reason: string,
  ): ActionIntent[] {
    const skill = this.skillRegistry.resolveForIntent(taskKey, ctx.village_id);
    if (!skill) {
      // 找不到對應的 verified skill → 跳過
      return [];
    }

    return [{
      kind: 'dispatch_task',
      task_key: taskKey,
      payload: {},
      estimated_cost: ctx.budget.per_action_limit * 0.5, // 預估成本為限額一半
      rollback_plan: `Revert ${taskKey} output`,
      reason,
      evidence_refs: eddaRefs,
      confidence: 0.7, // base confidence
    }];
  }

  // ---------------------------------------------------------------------------
  // Pipeline Layer 3: selectBest — Chief 人格權重
  // ---------------------------------------------------------------------------

  /**
   * 從候選列表中選出最佳 ActionIntent。
   * 套用 Chief constraints 過濾 + personality 排序。
   */
  private selectBest(candidates: ActionIntent[], ctx: DecideContext): ActionIntent | null {
    if (candidates.length === 0) return null;

    // 套用 Chief constraints 過濾
    let filtered = candidates.filter(c => {
      for (const constraint of ctx.chief.constraints) {
        if (constraint.type === 'must_not') {
          // must_not 匹配 → 移除候選
          const desc = constraint.description.toLowerCase();
          const actionDesc = `${c.kind} ${c.task_key ?? ''} ${c.reason}`.toLowerCase();
          if (actionDesc.includes(desc.split(' ')[0])) {
            return false;
          }
        }
      }
      return true;
    });

    if (filtered.length === 0) return null;

    // 套用 prefer/avoid constraints 調整 confidence
    filtered = filtered.map(c => {
      let adj = 0;
      for (const constraint of ctx.chief.constraints) {
        const desc = constraint.description.toLowerCase();
        const actionDesc = `${c.kind} ${c.task_key ?? ''} ${c.reason}`.toLowerCase();
        if (constraint.type === 'prefer' && actionDesc.includes(desc.split(' ')[0])) {
          adj += 0.1;
        }
        if (constraint.type === 'avoid' && actionDesc.includes(desc.split(' ')[0])) {
          adj -= 0.1;
        }
      }
      return adj !== 0 ? { ...c, confidence: Math.max(0, Math.min(1, c.confidence + adj)) } : c;
    });

    const riskTolerance = ctx.chief.personality?.risk_tolerance ?? 'moderate';

    // conservative: budget_ratio < 0.3 → 傾向 complete_cycle
    if (riskTolerance === 'conservative' && ctx.budget_ratio < 0.3) {
      const completeCycleCandidate = filtered.find(c => c.kind === 'complete_cycle');
      if (completeCycleCandidate) return completeCycleCandidate;
      // 如果沒有 complete_cycle，加一個高 cost 過濾
      filtered = filtered.filter(c => {
        if (c.kind === 'dispatch_task') {
          const budgetRemaining = ctx.budget.per_day_limit * ctx.budget_ratio;
          return c.estimated_cost <= budgetRemaining * 0.5;
        }
        return true;
      });
    }

    // 排序：confidence 高的優先
    filtered.sort((a, b) => b.confidence - a.confidence);

    return filtered[0] ?? null;
  }

  /**
   * 計算人格對 confidence 的調整值。
   */
  private applyPersonalityConfidence(
    action: ActionIntent,
    ctx: DecideContext,
    riskTolerance: string,
  ): number {
    let adjustment = 0;
    const hasNegativePrecedent = ctx.edda_precedents.some(p =>
      p.is_active && /harmful|rollback|failed/i.test(p.value),
    );
    const hasPositivePrecedent = ctx.edda_precedents.some(p =>
      p.is_active && /effective|success/i.test(p.value),
    );

    if (riskTolerance === 'conservative') {
      if (hasNegativePrecedent) adjustment -= 0.2;
      if (ctx.budget_ratio < 0.3) adjustment -= 0.1;
    } else if (riskTolerance === 'aggressive') {
      if (hasPositivePrecedent) adjustment += 0.15;
      // aggressive 傾向繼續
      if (action.kind === 'complete_cycle' && ctx.budget_ratio > 0.2) {
        adjustment -= 0.1; // 不那麼想停
      }
    }
    // moderate: 不做額外調整

    return adjustment;
  }

  // ---------------------------------------------------------------------------
  // Pipeline Layer 4: checkLawProposals — 觸發規則
  // ---------------------------------------------------------------------------

  /**
   * 檢查是否需要提案 law 修改。
   * 規則 1: 最近 3 輪同 category 都失敗 → 提案策略調整
   * 規則 2: harmful law 還是 active → 提案 revoke
   */
  private checkLawProposals(ctx: DecideContext): LawProposalDraft[] {
    const proposals: LawProposalDraft[] = [];
    const eddaRefs = ctx.edda_precedents.filter(p => p.is_active).map(p => p.event_id);

    // 規則 1: 連續失敗 → 提案策略調整
    // 使用 blocked + rollback 作為失敗指標
    if (ctx.blocked_count >= 3 || ctx.recent_rollbacks >= 3) {
      // 找出最常被阻擋的 action 類型
      const blockedTypes = (ctx.last_action?.blocked_reasons ?? []);
      const category = blockedTypes.length > 0 ? blockedTypes[0] : 'general';

      proposals.push({
        category,
        content: {
          description: `Adjust strategy: ${ctx.blocked_count} blocked actions and ${ctx.recent_rollbacks} recent rollbacks indicate current approach is failing`,
          strategy: { adjust: true, blocked_count: ctx.blocked_count, rollback_count: ctx.recent_rollbacks },
        },
        evidence: {
          source: 'decision_engine',
          reasoning: `Consecutive failures detected: ${ctx.blocked_count} blocked, ${ctx.recent_rollbacks} rollbacks in 24h`,
          edda_refs: eddaRefs,
        },
        trigger: `${ctx.blocked_count} blocked actions + ${ctx.recent_rollbacks} rollbacks`,
      });
    }

    // 規則 2: harmful law 還是 active → 提案 revoke
    for (const law of ctx.active_laws) {
      if (law.effectiveness?.verdict === 'harmful') {
        proposals.push({
          category: law.category,
          content: {
            description: `Revoke harmful law: ${law.content.description}`,
            strategy: { revoke_law_id: law.id },
          },
          evidence: {
            source: 'decision_engine',
            reasoning: `Law ${law.id} has verdict "harmful" but is still active`,
            edda_refs: eddaRefs,
          },
          trigger: `Law effectiveness verdict: harmful (measured at ${law.effectiveness.measured_at})`,
        });
      }
    }

    return proposals;
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
