import type { Database } from 'bun:sqlite';
import { appendAudit } from './db';
import type { CandidateIntentDraft } from './llm-advisor';
import type { SkillRegistry } from './skill-registry';
import type { DecideContext, ActionIntent } from './decision-engine';
import { checkRules } from './constitution-store';

// ---------------------------------------------------------------------------
// 確定性過濾結果
// ---------------------------------------------------------------------------

export interface FilteredCandidate {
  draft: CandidateIntentDraft;
  passed: boolean;
  reject_reason?: string;
  reject_step?: number;
}

export interface FilterPipelineResult {
  accepted: ActionIntent[];
  discarded: FilteredCandidate[];
}

// ---------------------------------------------------------------------------
// 5-Step Deterministic Filter Pipeline
// ---------------------------------------------------------------------------

/**
 * 對 LLM 產生的候選意圖草案執行 5 步確定性過濾。
 *
 * Step 1: task_key 必須在 SkillRegistry 中存在（verified）
 * Step 2: estimated_cost <= budget_remaining
 * Step 3: Chief constraints must_not 檢查
 * Step 4: Constitution rules 預檢
 * Step 5: 不可與已有候選重複（task_key）
 *
 * 被拒絕的候選記錄到 audit_log。
 */
export function filterCandidates(
  drafts: CandidateIntentDraft[],
  ctx: DecideContext,
  existingCandidates: ActionIntent[],
  skillRegistry: SkillRegistry,
  db: Database,
): FilterPipelineResult {
  const accepted: ActionIntent[] = [];
  const discarded: FilteredCandidate[] = [];
  const acceptedTaskKeys = new Set(
    existingCandidates
      .filter(c => c.task_key)
      .map(c => c.task_key),
  );

  for (const draft of drafts) {
    // Step 1: task_key 存在於 SkillRegistry（verified）
    const skill = skillRegistry.resolveForIntent(draft.task_key, ctx.village_id);
    if (!skill) {
      discarded.push({
        draft,
        passed: false,
        reject_reason: `task_key "${draft.task_key}" not found or not verified in SkillRegistry`,
        reject_step: 1,
      });
      continue;
    }

    // Step 2: estimated_cost <= budget_remaining
    const budgetRemaining = ctx.budget.per_day_limit * ctx.budget_ratio;
    if (draft.estimated_cost > budgetRemaining) {
      discarded.push({
        draft,
        passed: false,
        reject_reason: `estimated_cost ${draft.estimated_cost} exceeds budget_remaining ${budgetRemaining.toFixed(2)}`,
        reject_step: 2,
      });
      continue;
    }

    // 也檢查 per_action_limit
    if (draft.estimated_cost > ctx.budget.per_action_limit) {
      discarded.push({
        draft,
        passed: false,
        reject_reason: `estimated_cost ${draft.estimated_cost} exceeds per_action_limit ${ctx.budget.per_action_limit}`,
        reject_step: 2,
      });
      continue;
    }

    // Step 3: Chief constraints must_not 檢查
    const mustNotViolation = checkMustNot(draft, ctx);
    if (mustNotViolation) {
      discarded.push({
        draft,
        passed: false,
        reject_reason: mustNotViolation,
        reject_step: 3,
      });
      continue;
    }

    // Step 4: Constitution rules 預檢
    const actionText = `dispatch_task ${draft.task_key} ${draft.reason}`;
    const ruleCheck = checkRules(ctx.constitution, ctx.chief.id, actionText);
    if (!ruleCheck.allowed) {
      const violatedDescs = ruleCheck.violated.map(r => r.description).join('; ');
      discarded.push({
        draft,
        passed: false,
        reject_reason: `Constitution rule violation: ${violatedDescs}`,
        reject_step: 4,
      });
      continue;
    }

    // Step 5: 不可與已有候選重複（task_key）
    if (acceptedTaskKeys.has(draft.task_key)) {
      discarded.push({
        draft,
        passed: false,
        reject_reason: `Duplicate task_key "${draft.task_key}" already in candidates`,
        reject_step: 5,
      });
      continue;
    }

    // 通過所有檢查 → 轉換為 ActionIntent
    const eddaRefs = ctx.edda_precedents
      .filter(p => p.is_active)
      .map(p => p.event_id);

    accepted.push({
      kind: 'dispatch_task',
      task_key: draft.task_key,
      payload: draft.payload,
      estimated_cost: draft.estimated_cost,
      rollback_plan: `Revert ${draft.task_key} output`,
      reason: `[LLM] ${draft.reason}`,
      evidence_refs: eddaRefs,
      confidence: 0.6, // LLM 候選的 base confidence 略低於 rule-based
    });
    acceptedTaskKeys.add(draft.task_key);
  }

  // 記錄被拒絕的候選到 audit_log
  for (const d of discarded) {
    appendAudit(db, 'llm_candidate', ctx.cycle_id, 'filter_rejected', {
      task_key: d.draft.task_key,
      estimated_cost: d.draft.estimated_cost,
      reason: d.draft.reason,
      reject_step: d.reject_step,
      reject_reason: d.reject_reason,
    }, 'system');
  }

  return { accepted, discarded };
}

// ---------------------------------------------------------------------------
// 內部輔助
// ---------------------------------------------------------------------------

/**
 * 檢查 Chief must_not constraints。
 * 回傳 null 表示通過，回傳字串表示違反原因。
 */
function checkMustNot(draft: CandidateIntentDraft, ctx: DecideContext): string | null {
  const actionDesc = `dispatch_task ${draft.task_key} ${draft.reason}`.toLowerCase();

  for (const constraint of ctx.chief.constraints) {
    if (constraint.type === 'must_not') {
      const desc = constraint.description.toLowerCase();
      // 使用首個關鍵詞做匹配（與 DecisionEngine.selectBest 一致）
      if (actionDesc.includes(desc.split(' ')[0])) {
        return `Chief must_not constraint violated: "${constraint.description}"`;
      }
    }
  }

  return null;
}
