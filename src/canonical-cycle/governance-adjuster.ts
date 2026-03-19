/**
 * canonical-cycle/governance-adjuster.ts — 治理調整引擎
 *
 * 從 OutcomeReport 評估是否需要治理調整：
 * - ADJ-02: 只在 verdict=harmful 或 recommendation=rollback/retune 時觸發
 * - ADJ-01: 每筆調整必須指定 target + before/after
 *
 * 中性/有益/觀望的 outcome 不產生調整。
 *
 * @see docs/world-design-v0/shared-types.md §6.11
 */

import { generateId, ID_PREFIXES } from '../cross-layer/id-generator';
import type { OutcomeReport } from '../schemas/outcome-report';
import {
  GovernanceAdjustmentSchema,
  type GovernanceAdjustment,
  type AdjustmentType,
} from '../schemas/governance-adjustment';

// ---------------------------------------------------------------------------
// Trigger guard (ADJ-02)
// ---------------------------------------------------------------------------

/**
 * 判斷 OutcomeReport 是否需要觸發治理調整
 *
 * ADJ-02: 只在以下條件成立時觸發：
 * - verdict === 'harmful'
 * - recommendation === 'rollback' 或 'retune'
 */
export function shouldTriggerAdjustment(report: OutcomeReport): boolean {
  if (report.verdict === 'harmful') return true;
  if (report.recommendation === 'rollback' || report.recommendation === 'retune') return true;
  return false;
}

// ---------------------------------------------------------------------------
// Adjustment type derivation
// ---------------------------------------------------------------------------

/**
 * 從 outcome report 的 verdict + recommendation 推導調整類型
 *
 * - rollback → law_threshold（改變法律觸發條件）
 * - retune → risk_policy（微調風險策略）
 * - harmful + do_not_repeat → simulation_policy（強化模擬要求）
 */
function deriveAdjustmentType(report: OutcomeReport): AdjustmentType {
  if (report.recommendation === 'rollback') return 'law_threshold';
  if (report.recommendation === 'retune') return 'risk_policy';
  // harmful verdict with other recommendations
  return 'simulation_policy';
}

// ---------------------------------------------------------------------------
// Before/after description builders
// ---------------------------------------------------------------------------

function buildBefore(report: OutcomeReport): string {
  const effects = report.expectedEffects
    .filter(e => !e.matched)
    .map(e => `${e.metric}: expected change not observed (delta=${e.delta})`)
    .join('; ');

  const sideEffects = report.sideEffects
    .filter(s => s.severity === 'significant')
    .map(s => `${s.metric}: significant side effect (delta=${s.delta})`)
    .join('; ');

  const parts = [effects, sideEffects].filter(Boolean);
  return parts.length > 0
    ? `Current policy produced: ${parts.join('; ')}`
    : `Current policy produced verdict=${report.verdict}`;
}

function buildAfter(report: OutcomeReport): string {
  switch (report.recommendation) {
    case 'rollback':
      return 'Rollback to pre-change state; tighten approval thresholds for similar changes';
    case 'retune':
      return 'Adjust policy parameters to reduce side effects while preserving intent';
    case 'do_not_repeat':
      return 'Add simulation requirement for this change kind; block auto-approval';
    default:
      return `Apply corrective adjustment based on ${report.verdict} verdict`;
  }
}

// ---------------------------------------------------------------------------
// Main evaluation function
// ---------------------------------------------------------------------------

/**
 * 評估 OutcomeReport 是否需要治理調整
 *
 * @param report - 已完成的 OutcomeReport
 * @param worldId - 世界 ID
 * @returns GovernanceAdjustment 或 null（不需調整時）
 */
export function evaluateOutcomeForAdjustment(
  report: OutcomeReport,
  worldId: string,
): GovernanceAdjustment | null {
  // ADJ-02: 只在特定條件下觸發
  if (!shouldTriggerAdjustment(report)) {
    return null;
  }

  const adjustmentType = deriveAdjustmentType(report);
  const rationale = report.notes.length > 0
    ? report.notes.join('; ')
    : `Triggered by outcome verdict=${report.verdict}, recommendation=${report.recommendation}`;

  return GovernanceAdjustmentSchema.parse({
    id: generateId(ID_PREFIXES.adjustment),
    worldId,
    triggeredBy: report.id,
    adjustmentType,
    target: report.appliedChangeId, // ADJ-01: target 指向觸發的 change
    before: buildBefore(report),     // ADJ-01: 調整前描述
    after: buildAfter(report),       // ADJ-01: 調整後描述
    rationale,
    status: 'proposed',
    createdAt: new Date().toISOString(),
    version: 1,
  });
}
