/**
 * canonical-cycle/governance-adjuster.ts — Governance Adjustment Engine
 *
 * Evaluate OutcomeReports and produce GovernanceAdjustments when warranted.
 *
 * CONTRACT: ADJ-02 — Only fires when verdict=harmful OR recommendation=rollback/retune
 * CONTRACT: ADJ-01 — Each adjustment must specify target + before/after
 *
 * @see docs/plan/world-cycle/TRACK_G_GOVERNANCE_ADJUSTMENT.md Step 1
 * @see docs/world-design-v0/shared-types.md §6.11
 */

import { nanoid } from 'nanoid';
import type { OutcomeReport } from '../schemas/outcome-report';
import type { GovernanceAdjustment, AdjustmentType } from '../schemas/governance-adjustment';
import { GovernanceAdjustmentSchema } from '../schemas/governance-adjustment';

// ---------------------------------------------------------------------------
// AdjustmentContext — 調整上下文
// ---------------------------------------------------------------------------

export interface AdjustmentContext {
  worldId: string;
  activeTarget: string;   // e.g., "laws.flow_control.peakInterventionThreshold"
  currentValue: string;    // e.g., "85"
  suggestedValue: string;  // e.g., "78"
}

// ---------------------------------------------------------------------------
// Main evaluation function
// ---------------------------------------------------------------------------

/**
 * Evaluate an OutcomeReport and produce a GovernanceAdjustment if warranted.
 *
 * ADJ-02: Only fires when:
 * - verdict === 'harmful', OR
 * - recommendation === 'rollback' | 'retune'
 *
 * Returns null when no adjustment is needed (beneficial, neutral, watch, reinforce).
 */
export function evaluateOutcomeForAdjustment(
  report: OutcomeReport,
  context: AdjustmentContext,
): GovernanceAdjustment | null {
  // ADJ-02: Only fire on harmful verdict or rollback/retune recommendation
  const shouldAdjust =
    report.verdict === 'harmful' ||
    report.recommendation === 'rollback' ||
    report.recommendation === 'retune';

  if (!shouldAdjust) return null;

  const adjustmentType = inferAdjustmentType(report);
  const { target, before, after } = inferTargetChange(report, context);
  const rationale = buildRationale(report);

  const adjustment: GovernanceAdjustment = {
    id: `adj_${nanoid(12)}`,
    worldId: context.worldId,
    triggeredBy: report.id,
    adjustmentType,
    target,   // ADJ-01
    before,   // ADJ-01
    after,    // ADJ-01
    rationale,
    status: 'proposed',
    createdAt: new Date().toISOString(),
    version: 1,
  };

  // Validate through schema before returning
  return GovernanceAdjustmentSchema.parse(adjustment);
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * Infer which governance lever to adjust based on the outcome report.
 *
 * - Side effect on fairness metrics → law_threshold
 * - Rollback recommendation → risk_policy (thresholds were too loose)
 * - Retune recommendation → law_threshold (parameters need refinement)
 */
function inferAdjustmentType(report: OutcomeReport): AdjustmentType {
  // If significant side effects on fairness metrics → law_threshold
  const hasSignificantSideEffects = report.sideEffects.some(
    se => se.severity === 'significant' && !se.acceptable
  );

  if (report.recommendation === 'rollback') return 'risk_policy';
  if (hasSignificantSideEffects) return 'law_threshold';
  return 'law_threshold'; // default for retune and harmful
}

/**
 * Infer target, before, and after values for the adjustment.
 */
function inferTargetChange(
  _report: OutcomeReport,
  context: AdjustmentContext,
): { target: string; before: string; after: string } {
  return {
    target: context.activeTarget,
    before: context.currentValue,
    after: context.suggestedValue,
  };
}

/**
 * Build rationale string from outcome report.
 */
function buildRationale(report: OutcomeReport): string {
  const parts: string[] = [];
  parts.push(`Outcome verdict: ${report.verdict}`);
  parts.push(`Recommendation: ${report.recommendation}`);

  if (!report.primaryObjectiveMet) {
    parts.push('Primary objective was not met');
  }

  const significantSides = report.sideEffects.filter(se => se.severity === 'significant');
  if (significantSides.length > 0) {
    parts.push(`Significant side effects on: ${significantSides.map(s => s.metric).join(', ')}`);
  }

  return parts.join('. ');
}
