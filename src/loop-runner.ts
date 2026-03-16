import type { Database } from 'bun:sqlite';
import { randomUUID } from 'crypto';
import { appendAudit } from './db';
import type { ConstitutionStore, Constitution } from './constitution-store';
import type { ChiefEngine, Chief } from './chief-engine';
import type { LawEngine } from './law-engine';
import type { RiskAssessor, Action, AssessmentResult } from './risk-assessor';
import type { EddaBridge, EddaDecisionHit } from './edda-bridge';
import type { SkillRegistry } from './skill-registry';
import type { DecisionEngine, ActionIntent, DecideResult } from './decision-engine';

import { CycleMetricsCollector } from './cycle-metrics';
import { snapshotWorldState } from './world/snapshot';
import { StartCycleInput as StartCycleSchema } from './schemas/loop';
import type { StartCycleInputRaw, LoopAction, CycleIntent } from './schemas/loop';

export interface LoopCycle {
  id: string;
  village_id: string;
  chief_id: string;
  trigger: 'scheduled' | 'event' | 'manual';
  status: 'running' | 'completed' | 'timeout' | 'aborted';
  version: number;
  budget_remaining: number;
  cost_incurred: number;
  iterations: number;
  max_iterations: number;
  timeout_ms: number;
  actions: LoopAction[];
  laws_proposed: string[];
  laws_enacted: string[];
  abort_reason: string | null;
  intent: CycleIntent | null;
  created_at: string;
  updated_at: string;
}

interface Decision {
  action_type: string;
  description: string;
  estimated_cost: number;
  reason: string;
  rollback_plan: string;
  edda_refs?: string[];
}

export class LoopRunner {
  private abortControllers = new Map<string, AbortController>();

  constructor(
    private db: Database,
    private constitutionStore: ConstitutionStore,
    private chiefEngine: ChiefEngine,
    private lawEngine: LawEngine,
    private riskAssessor: RiskAssessor,
    private eddaBridge?: EddaBridge,
    private skillRegistry?: SkillRegistry,
    private decisionEngine?: DecisionEngine,
    // LlmAdvisor slot reserved for Phase 1 (currently handled by DecisionEngine)
  ) {}

  startCycle(villageId: string, rawInput: StartCycleInputRaw): LoopCycle {
    const input = StartCycleSchema.parse(rawInput);

    // Validate chief exists and is active
    const chief = this.chiefEngine.get(input.chief_id);
    if (!chief || chief.status !== 'active') throw new Error('Chief not found or inactive');
    if (chief.village_id !== villageId) throw new Error('Chief does not belong to this village');

    // Validate constitution
    const constitution = this.constitutionStore.getActive(villageId);
    if (!constitution) throw new Error('No active constitution');

    const now = new Date().toISOString();
    const cycle: LoopCycle = {
      id: `cycle-${randomUUID()}`,
      village_id: villageId,
      chief_id: input.chief_id,
      trigger: input.trigger,
      status: 'running',
      version: 1,
      budget_remaining: constitution.budget_limits.max_cost_per_loop,
      cost_incurred: 0,
      iterations: 0,
      max_iterations: input.max_iterations,
      timeout_ms: input.timeout_ms,
      actions: [],
      laws_proposed: [],
      laws_enacted: [],
      abort_reason: null,
      intent: input.intent ?? null,
      created_at: now,
      updated_at: now,
    };

    this.db.prepare(`
      INSERT INTO loop_cycles (id, village_id, chief_id, trigger, status, version,
        budget_remaining, cost_incurred, iterations, max_iterations, timeout_ms,
        actions, laws_proposed, laws_enacted, intent, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      cycle.id, villageId, input.chief_id, cycle.trigger, cycle.status, cycle.version,
      cycle.budget_remaining, cycle.cost_incurred, cycle.iterations, cycle.max_iterations,
      cycle.timeout_ms, '[]', '[]', '[]',
      cycle.intent ? JSON.stringify(cycle.intent) : null,
      now, now,
    );

    appendAudit(this.db, 'loop', cycle.id, 'start', { trigger: cycle.trigger, chief_id: input.chief_id }, input.chief_id);

    // Set up abort controller (SI-1: human can stop anytime)
    const ac = new AbortController();
    this.abortControllers.set(cycle.id, ac);

    // Run the loop async — don't await it
    this.runLoop(cycle, chief, constitution, ac.signal)
      .catch(() => { /* errors handled inside runLoop catch block */ });

    return cycle;
  }

  async runLoop(cycle: LoopCycle, chief: Chief, constitution: Constitution, signal: AbortSignal): Promise<void> {
    // Dispatch to V1 flow if DecisionEngine is available
    if (this.decisionEngine) {
      return this.runLoopV1(cycle, chief, constitution, signal);
    }

    // Yield to let startCycle return before loop begins
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Timeout handler (THY-08)
    const timeoutId = setTimeout(() => {
      this.finishCycle(cycle.id, 'timeout', 'Timeout exceeded');
    }, cycle.timeout_ms);

    try {
      for (let i = 0; i < cycle.max_iterations; i++) {
        // SI-1: Check abort signal
        if (signal.aborted) {
          this.finishCycle(cycle.id, 'aborted', 'Human stop');
          return;
        }

        // Re-read cycle to get latest state
        const current = this.get(cycle.id);
        if (!current || current.status !== 'running') return;

        // Budget check
        if (current.budget_remaining <= 0) {
          this.finishCycle(cycle.id, 'completed', 'Budget exhausted');
          return;
        }

        // Phase 1: OBSERVE
        const observations = this.observe(cycle.village_id);

        // Phase 2: DECIDE (rule-based Phase 0)
        const activeLaws = this.lawEngine.getActiveLaws(cycle.village_id);
        const decision = await this.decide(chief, activeLaws, observations, cycle.village_id);
        if (!decision) {
          // No action needed — complete
          this.finishCycle(cycle.id, 'completed', 'No more actions needed');
          return;
        }

        // Phase 3: ACT with risk gating
        const action: Action = {
          type: decision.action_type,
          description: decision.description,
          initiated_by: chief.id,
          village_id: cycle.village_id,
          estimated_cost: decision.estimated_cost,
          reason: decision.reason,
          rollback_plan: decision.rollback_plan,
        };

        const assessment = this.riskAssessor.assess(action, {
          constitution,
          recent_rollbacks: [],
          chief_personality: chief.personality,
          loop_id: cycle.id,
          chief_max_monthly: chief.budget_config?.max_monthly,
          budget_reset_day: chief.budget_config?.budget_reset_day,
        });

        const loopAction = this.processAssessment(decision, assessment);

        // Record cost if executed
        if (loopAction.status === 'executed') {
          this.riskAssessor.recordSpend(cycle.village_id, cycle.id, decision.estimated_cost);
          // Auto-pause check: if monthly budget exceeded after spend
          this.checkAndPauseIfExceeded(chief, constitution);
        }

        // Update cycle
        this.recordAction(cycle.id, loopAction, decision.estimated_cost);

        // Yield control to allow abort signal processing
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      // Max iterations reached
      this.finishCycle(cycle.id, 'completed', 'Max iterations reached');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.finishCycle(cycle.id, 'aborted', `Loop error: ${msg}`);
    } finally {
      clearTimeout(timeoutId);
      this.abortControllers.delete(cycle.id);
    }
  }

  /**
   * V1 control flow — 7-step DecisionEngine-driven loop.
   * Used when DecisionEngine is injected via constructor.
   *
   * Steps: COMPREHEND → DECIDE → PROPOSE → ACT → UPDATE → RECORD → YIELD
   */
  private async runLoopV1(
    cycle: LoopCycle,
    chief: Chief,
    constitution: Constitution,
    signal: AbortSignal,
  ): Promise<void> {
    if (!this.decisionEngine) throw new Error('DecisionEngine required for V1 loop');
    const de = this.decisionEngine;

    // Yield to let startCycle return before loop begins
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Timeout handler (THY-08)
    const timeoutId = setTimeout(() => {
      this.finishCycle(cycle.id, 'timeout', 'Timeout exceeded');
    }, cycle.timeout_ms);

    try {
      for (let i = 0; i < cycle.max_iterations; i++) {
        // SI-1: Check abort signal
        if (signal.aborted) {
          this.finishCycle(cycle.id, 'aborted', 'Human stop');
          return;
        }

        // Re-read cycle to get latest state
        const current = this.get(cycle.id);
        if (!current || current.status !== 'running') return;

        // Budget check
        if (current.budget_remaining <= 0) {
          this.finishCycle(cycle.id, 'completed', 'Budget exhausted');
          return;
        }

        // --- Step 1: COMPREHEND ---
        const observations = this.observe(cycle.village_id);
        const context = await de.buildContext(
          cycle.village_id,
          chief.id,
          observations,
          {
            cycle_id: cycle.id,
            iteration: i,
            max_iterations: cycle.max_iterations,
            loop_id: cycle.id,
            actions: current.actions,
            intent: current.intent,
          },
        );

        // --- Step 2: DECIDE ---
        const result = await de.decide(context);

        // 記錄 DecideSnapshot（用於 replay / 決定性測試）
        CycleMetricsCollector.snapshot(this.db, context, result, 'v0.1');

        // --- Step 3: PROPOSE LAWS (governance before execution) ---
        const proposedLawIds: string[] = [];
        for (const proposal of result.law_proposals) {
          try {
            const law = this.lawEngine.propose(cycle.village_id, chief.id, {
              category: proposal.category,
              content: proposal.content,
              evidence: proposal.evidence,
            });
            proposedLawIds.push(law.id);
          } catch {
            // 提案失敗不阻擋主流程（例如 chief 缺乏 propose_law 權限）
          }
        }
        // 記錄 proposed laws 到 cycle
        if (proposedLawIds.length > 0) {
          this.recordLawProposals(cycle.id, proposedLawIds);
        }

        // --- Step 4: ACT ---
        const actionIntent = result.action;

        if (!actionIntent) {
          // No action needed — complete cycle
          this.finishCycle(cycle.id, 'completed', 'No more actions needed');
          return;
        }

        if (actionIntent.kind === 'complete_cycle') {
          this.finishCycle(cycle.id, 'completed', actionIntent.reason);
          return;
        }

        if (actionIntent.kind === 'wait') {
          // 記錄 wait action 並跳到下一迭代
          const waitAction: LoopAction = {
            type: 'wait',
            description: actionIntent.reason,
            estimated_cost: 0,
            risk_level: 'low',
            status: 'executed',
            reason: actionIntent.reason,
          };
          this.recordAction(cycle.id, waitAction, 0);
          this.recordDecisionAudit(cycle.id, i, actionIntent, result, proposedLawIds, chief.id);
          await new Promise((resolve) => setTimeout(resolve, 0));
          continue;
        }

        if (actionIntent.kind === 'dispatch_task') {
          this.handleDispatchTask(actionIntent, cycle, chief, constitution);
        }

        // --- Steps 5-7: UPDATE INTENT + RECORD + YIELD ---
        this.recordDecisionAudit(cycle.id, i, actionIntent, result, proposedLawIds, chief.id);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      // Max iterations reached
      this.finishCycle(cycle.id, 'completed', 'Max iterations reached');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.finishCycle(cycle.id, 'aborted', `Loop error: ${msg}`);
    } finally {
      clearTimeout(timeoutId);
      this.abortControllers.delete(cycle.id);
    }
  }

  /** 持久化 intent 到 loop_cycles 表 */
  private persistIntent(cycleId: string, intent: CycleIntent | null): void {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE loop_cycles SET intent = ?, updated_at = ? WHERE id = ?')
      .run(intent ? JSON.stringify(intent) : null, now, cycleId);
  }

  /**
   * 處理 dispatch_task 類型的 action：解析 skill、風險評估、記錄。
   */
  private handleDispatchTask(
    actionIntent: ActionIntent,
    cycle: LoopCycle,
    chief: Chief,
    constitution: Constitution,
  ): void {
    const taskKey = actionIntent.task_key ?? 'unknown';
    let skillResolved = false;

    if (this.skillRegistry) {
      const skill = this.skillRegistry.resolveForIntent(taskKey, cycle.village_id);
      skillResolved = !!skill;
    }

    if (!skillResolved) {
      const blockedAction: LoopAction = {
        type: taskKey,
        description: `dispatch_task: ${taskKey}`,
        estimated_cost: actionIntent.estimated_cost,
        risk_level: 'low',
        status: 'blocked',
        reason: actionIntent.reason,
        blocked_reasons: [`No verified skill found for task_key: ${taskKey}`],
      };
      this.recordAction(cycle.id, blockedAction, actionIntent.estimated_cost);
      return;
    }

    const action: Action = {
      type: taskKey,
      description: `dispatch_task: ${taskKey}`,
      initiated_by: chief.id,
      village_id: cycle.village_id,
      estimated_cost: actionIntent.estimated_cost,
      reason: actionIntent.reason,
      rollback_plan: actionIntent.rollback_plan,
    };

    const assessment = this.riskAssessor.assess(action, {
      constitution,
      recent_rollbacks: [],
      chief_personality: chief.personality,
      loop_id: cycle.id,
      chief_max_monthly: chief.budget_config?.max_monthly,
      budget_reset_day: chief.budget_config?.budget_reset_day,
    });

    const decision: Decision = {
      action_type: taskKey,
      description: `dispatch_task: ${taskKey}`,
      estimated_cost: actionIntent.estimated_cost,
      reason: actionIntent.reason,
      rollback_plan: actionIntent.rollback_plan,
    };

    const loopAction = this.processAssessment(decision, assessment);

    if (loopAction.status === 'executed') {
      this.riskAssessor.recordSpend(cycle.village_id, cycle.id, actionIntent.estimated_cost);
      // Auto-pause check: if monthly budget exceeded after spend
      this.checkAndPauseIfExceeded(chief, constitution);
    }

    this.recordAction(cycle.id, loopAction, actionIntent.estimated_cost);
  }

  /**
   * 記錄決策審計（intent 更新 + audit log + Edda 記錄）。
   */
  private recordDecisionAudit(
    cycleId: string,
    iteration: number,
    actionIntent: ActionIntent,
    result: DecideResult,
    proposedLawIds: string[],
    chiefId: string,
  ): void {
    // Update intent
    if (result.updated_intent) {
      this.persistIntent(cycleId, result.updated_intent);
    }

    // Audit log
    appendAudit(this.db, 'loop', cycleId, 'decision', {
      iteration,
      action_kind: actionIntent.kind,
      task_key: actionIntent.kind === 'dispatch_task' ? actionIntent.task_key : undefined,
      reasoning: result.reasoning.summary,
      law_proposals: proposedLawIds,
    }, chiefId);

    // Fire-and-forget Edda recording
    if (this.eddaBridge) {
      void this.eddaBridge.recordDecision({
        domain: 'loop',
        aspect: `${cycleId}.iteration.${iteration}`,
        value: `${actionIntent.kind}${actionIntent.kind === 'dispatch_task' ? `:${actionIntent.task_key}` : ''}`,
        reason: result.reasoning.summary,
      }).catch(() => {});
    }
  }

  /** 記錄 law proposal IDs 到 cycle 的 laws_proposed 欄位 */
  private recordLawProposals(cycleId: string, lawIds: string[]): void {
    const cycle = this.get(cycleId);
    if (!cycle) return;
    const merged = [...cycle.laws_proposed, ...lawIds];
    const now = new Date().toISOString();
    this.db.prepare('UPDATE loop_cycles SET laws_proposed = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(merged), now, cycleId);
  }

  observe(villageId: string): Record<string, unknown>[] {
    const internal = this.observeInternal(villageId);
    const karvi = this.observeKarviEvents(villageId);
    // Merge and sort by created_at descending, limit to 20
    const combined = [...internal, ...karvi]
      .sort((a, b) => {
        const ta = a.created_at as string;
        const tb = b.created_at as string;
        return tb.localeCompare(ta);
      })
      .slice(0, 20);
    return combined;
  }

  /** Query internal entity audit entries (villages, chiefs, laws, budget) */
  private observeInternal(villageId: string): Record<string, unknown>[] {
    return this.db.prepare(`
      SELECT * FROM audit_log WHERE entity_id IN (
        SELECT id FROM villages WHERE id = ?
        UNION SELECT id FROM chiefs WHERE village_id = ?
        UNION SELECT id FROM laws WHERE village_id = ?
      ) OR (entity_type = 'budget' AND entity_id = ?)
      ORDER BY created_at DESC LIMIT 20
    `).all(villageId, villageId, villageId, villageId) as Record<string, unknown>[];
  }

  /** Query karvi_event entries from audit_log for the observe phase, filtered by village */
  observeKarviEvents(villageId: string, limit = 20): Record<string, unknown>[] {
    const rows = this.db.prepare(`
      SELECT *, 'karvi' as source FROM audit_log
      WHERE entity_type = 'karvi_event'
        AND json_extract(payload, '$.village_id') = ?
      ORDER BY created_at DESC LIMIT ?
    `).all(villageId, limit) as Record<string, unknown>[];
    return rows;
  }

  async decide(_chief: Chief, _activeLaws: unknown[], observations: Record<string, unknown>[], villageId?: string): Promise<Decision | null> {
    // Phase 0: Rule-based decision engine
    // In Phase 0, we return null (no action) after observing — the loop completes immediately
    // Phase 1 will plug in LLM-based decision making
    if (observations.length === 0) return null;

    // Query Edda for village-scoped precedents (graceful degradation)
    let eddaPrecedents: EddaDecisionHit[] = [];
    if (this.eddaBridge && villageId) {
      try {
        const result = await this.eddaBridge.queryDecisions({ domain: 'law', keyword: villageId });
        eddaPrecedents = result.decisions;
      } catch {
        // Edda offline → proceed without precedents
      }
    }

    // Check if there's a "pending_review" action in observations
    for (const obs of observations) {
      const action = obs.action as string | undefined;
      if (action === 'proposed') {
        // There's a proposed law that might need attention
        return null; // Phase 0: don't auto-act on proposals
      }
    }

    // Attach edda_refs if precedents were found (for future Phase 1 LLM usage)
    if (eddaPrecedents.length > 0) {
      // Phase 0 still returns null, but when Phase 1 produces decisions,
      // edda_refs will be attached. Store them for potential use.
      return null; // Phase 0: complete immediately
    }

    return null; // Phase 0: complete immediately
  }

  /**
   * Execute a decision directly — used for testing and external action injection
   */
  executeAction(cycleId: string, decision: Decision): LoopAction {
    const cycle = this.get(cycleId);
    if (!cycle || cycle.status !== 'running') throw new Error('Cycle not found or not running');

    const chief = this.chiefEngine.get(cycle.chief_id);
    if (!chief) throw new Error('Chief not found');

    const constitution = this.constitutionStore.getActive(cycle.village_id);

    const action: Action = {
      type: decision.action_type,
      description: decision.description,
      initiated_by: chief.id,
      village_id: cycle.village_id,
      estimated_cost: decision.estimated_cost,
      reason: decision.reason,
      rollback_plan: decision.rollback_plan,
    };

    const assessment = this.riskAssessor.assess(action, {
      constitution: constitution ?? null,
      recent_rollbacks: [],
      chief_personality: chief.personality,
      loop_id: cycleId,
      chief_max_monthly: chief.budget_config?.max_monthly,
      budget_reset_day: chief.budget_config?.budget_reset_day,
    });

    const loopAction = this.processAssessment(decision, assessment);

    if (loopAction.status === 'executed') {
      this.riskAssessor.recordSpend(cycle.village_id, cycleId, decision.estimated_cost);
      // Auto-pause check: if monthly budget exceeded after spend
      if (constitution) {
        this.checkAndPauseIfExceeded(chief, constitution);
      }
    }

    this.recordAction(cycleId, loopAction, decision.estimated_cost);
    return loopAction;
  }

  /** 檢查月預算累計，超限則自動暫停 chief (#226) */
  private checkAndPauseIfExceeded(chief: Chief, constitution: Constitution): void {
    const resetDay = chief.budget_config?.budget_reset_day ?? 1;
    const constitutionLimit = constitution.budget_limits.max_cost_per_month ?? 0;
    const chiefLimit = chief.budget_config?.max_monthly;
    const effectiveLimit = chiefLimit ?? constitutionLimit;

    // 0 = unlimited
    if (effectiveLimit <= 0) return;

    const spentMonth = this.riskAssessor.getSpentMonth(chief.village_id, resetDay);
    if (spentMonth >= effectiveLimit) {
      try {
        this.chiefEngine.pauseChief(chief.id, 'MONTHLY_BUDGET_EXCEEDED');
      } catch {
        // Chief 可能已經被 pause 或 inactive
      }
    }
  }

  private processAssessment(decision: Decision, assessment: AssessmentResult): LoopAction {
    if (assessment.blocked) {
      return {
        type: decision.action_type,
        description: decision.description,
        estimated_cost: decision.estimated_cost,
        risk_level: assessment.level,
        status: 'blocked',
        reason: decision.reason,
        blocked_reasons: assessment.reasons.map((r) => r.message),
      };
    }

    if (assessment.level !== 'low') {
      return {
        type: decision.action_type,
        description: decision.description,
        estimated_cost: decision.estimated_cost,
        risk_level: assessment.level,
        status: 'pending_approval',
        reason: decision.reason,
      };
    }

    // Low risk → execute
    return {
      type: decision.action_type,
      description: decision.description,
      estimated_cost: decision.estimated_cost,
      risk_level: 'low',
      status: 'executed',
      reason: decision.reason,
      result: { success: true },
    };
  }

  private recordAction(cycleId: string, action: LoopAction, cost: number): void {
    const cycle = this.get(cycleId);
    if (!cycle) return;

    const actions = [...cycle.actions, action];
    const costIncurred = action.status === 'executed' ? cycle.cost_incurred + cost : cycle.cost_incurred;
    const budgetRemaining = action.status === 'executed' ? cycle.budget_remaining - cost : cycle.budget_remaining;
    const now = new Date().toISOString();

    this.db.prepare(`
      UPDATE loop_cycles SET actions = ?, cost_incurred = ?, budget_remaining = ?,
        iterations = iterations + 1, updated_at = ? WHERE id = ?
    `).run(JSON.stringify(actions), costIncurred, budgetRemaining, now, cycleId);

    appendAudit(this.db, 'loop', cycleId, 'action', action, cycle.chief_id);
  }

  private finishCycle(cycleId: string, status: LoopCycle['status'], reason: string): void {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE loop_cycles SET status = ?, abort_reason = ?, updated_at = ? WHERE id = ? AND status = ?')
      .run(status, reason, now, cycleId, 'running');
    appendAudit(this.db, 'loop', cycleId, status, { reason }, 'system');

    // 記錄 CycleMetrics（THY-07: append-only audit）
    const finishedCycle = this.get(cycleId);
    if (finishedCycle) {
      const metrics = CycleMetricsCollector.collect(finishedCycle);
      CycleMetricsCollector.record(this.db, cycleId, metrics);

      // Snapshot world state at cycle boundary（issue #187）
      try {
        const snapshotId = snapshotWorldState(this.db, finishedCycle.village_id, 'cycle_end');
        appendAudit(this.db, 'world_snapshot', snapshotId, 'cycle_snapshot', {
          cycle_id: cycleId,
          snapshot_id: snapshotId,
          cycle_status: status,
          reason,
        }, 'system');
      } catch {
        // Snapshot 失敗不影響 cycle 結束（graceful degradation）
      }
    }

    this.abortControllers.delete(cycleId);
  }

  abortCycle(cycleId: string, reason: string): LoopCycle {
    const cycle = this.get(cycleId);
    if (!cycle || cycle.status !== 'running') throw new Error('Cycle not found or not running');

    // Signal abort via AbortController (SI-1)
    const ac = this.abortControllers.get(cycleId);
    if (ac) ac.abort();

    this.finishCycle(cycleId, 'aborted', reason);
    return { ...cycle, status: 'aborted', abort_reason: reason };
  }

  get(id: string): LoopCycle | null {
    const row = this.db.prepare('SELECT * FROM loop_cycles WHERE id = ?').get(id) as Record<string, unknown> | null;
    return row ? this.deserialize(row) : null;
  }

  listCycles(villageId: string, opts?: { status?: string }): LoopCycle[] {
    let sql = 'SELECT * FROM loop_cycles WHERE village_id = ?';
    const params: string[] = [villageId];
    if (opts?.status) {
      sql += ' AND status = ?';
      params.push(opts.status);
    }
    sql += ' ORDER BY created_at DESC';
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.deserialize(r));
  }

  getActions(cycleId: string): LoopAction[] {
    const cycle = this.get(cycleId);
    return cycle?.actions ?? [];
  }

  private deserialize(row: Record<string, unknown>): LoopCycle {
    return {
      id: row.id as string,
      village_id: row.village_id as string,
      chief_id: row.chief_id as string,
      trigger: row.trigger as LoopCycle['trigger'],
      status: row.status as LoopCycle['status'],
      version: row.version as number,
      budget_remaining: row.budget_remaining as number,
      cost_incurred: row.cost_incurred as number,
      iterations: row.iterations as number,
      max_iterations: row.max_iterations as number,
      timeout_ms: row.timeout_ms as number,
      actions: JSON.parse((row.actions as string) || '[]') as LoopCycle['actions'],
      laws_proposed: JSON.parse((row.laws_proposed as string) || '[]') as LoopCycle['laws_proposed'],
      laws_enacted: JSON.parse((row.laws_enacted as string) || '[]') as LoopCycle['laws_enacted'],
      abort_reason: (row.abort_reason as string) || null,
      intent: row.intent ? JSON.parse(row.intent as string) as LoopCycle['intent'] : null,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    };
  }
}
