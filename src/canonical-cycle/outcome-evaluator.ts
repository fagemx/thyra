/**
 * canonical-cycle/outcome-evaluator.ts — Outcome 評估器
 *
 * 比較 baseline snapshot 與 current snapshot 的 metric deltas：
 * - 檢查預期效果是否達成（ExpectedEffectResult）
 * - 偵測非預期的副作用（SideEffectResult）
 * - 分類副作用嚴重度：negligible (<5%), minor (5-15%), significant (>15%)
 *
 * CONTRACT: OUTCOME-02 — OutcomeReports compare baseline vs observed with delta
 *
 * @see docs/plan/world-cycle/TRACK_E_OUTCOME_COLLECTOR.md Step 2
 * @see docs/world-design-v0/pulse-and-outcome-metrics-v0.md §20-22
 */

import type { ExpectedEffectResult, SideEffectResult } from '../schemas/outcome-report';

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface ExpectedEffect {
  metric: string;
  expectedDirection: 'up' | 'down' | 'stable';
}

export interface EvaluationInput {
  /** baseline metric values (snapshot at window open) */
  baselineSnapshot: Record<string, number>;
  /** current metric values (snapshot at evaluation time) */
  currentSnapshot: Record<string, number>;
  /** metrics with expected directional changes */
  expectedEffects: ExpectedEffect[];
  /** additional metrics to monitor for unintended changes */
  sideEffectMetrics: string[];
}

export interface EvaluationResult {
  /** true if all expected effects matched their direction */
  primaryObjectiveMet: boolean;
  /** per-metric comparison of expected effects */
  expectedEffects: ExpectedEffectResult[];
  /** detected side effects on non-target metrics */
  sideEffects: SideEffectResult[];
}

// ---------------------------------------------------------------------------
// Severity thresholds
// ---------------------------------------------------------------------------

/** 副作用嚴重度閾值（基於百分比變化） */
const NEGLIGIBLE_THRESHOLD = 0.05; // < 5%
const MINOR_THRESHOLD = 0.15;      // 5% - 15%
// > 15% = significant

// ---------------------------------------------------------------------------
// Direction matching
// ---------------------------------------------------------------------------

/**
 * 判斷 delta 是否符合預期方向
 *
 * - up: delta > 0
 * - down: delta < 0
 * - stable: |delta| < 0.01（忽略微小浮點誤差）
 */
function matchesDirection(delta: number, direction: 'up' | 'down' | 'stable'): boolean {
  switch (direction) {
    case 'up': return delta > 0;
    case 'down': return delta < 0;
    case 'stable': return Math.abs(delta) < 0.01;
  }
}

// ---------------------------------------------------------------------------
// Side effect severity classification
// ---------------------------------------------------------------------------

/**
 * 分類副作用嚴重度
 *
 * 基於 baseline 的百分比變化：
 * - negligible: < 5%
 * - minor: 5% - 15%
 * - significant: > 15%
 *
 * baseline = 0 且 observed 有變化時，視為 significant
 */
function classifySeverity(
  baseline: number,
  delta: number,
): 'negligible' | 'minor' | 'significant' {
  // baseline 為零時，任何非零 delta 都是 significant
  if (baseline === 0) {
    return Math.abs(delta) < 0.01 ? 'negligible' : 'significant';
  }

  const pctChange = Math.abs(delta / baseline);

  if (pctChange < NEGLIGIBLE_THRESHOLD) return 'negligible';
  if (pctChange < MINOR_THRESHOLD) return 'minor';
  return 'significant';
}

// ---------------------------------------------------------------------------
// Main evaluation function
// ---------------------------------------------------------------------------

/**
 * 評估 outcome：比較 baseline vs current metrics
 *
 * 1. 對每個 expectedEffect 計算 delta，判斷是否符合預期方向
 * 2. 對 sideEffectMetrics 中非預期效果的 metric，偵測並分類變動
 * 3. primaryObjectiveMet = 所有預期效果都 matched（空列表 = false）
 */
export function evaluateOutcome(input: EvaluationInput): EvaluationResult {
  // --- 預期效果比較 ---
  const expectedResults: ExpectedEffectResult[] = input.expectedEffects.map(effect => {
    const baseline = input.baselineSnapshot[effect.metric] ?? 0;
    const observed = input.currentSnapshot[effect.metric] ?? 0;
    const delta = observed - baseline;
    const matched = matchesDirection(delta, effect.expectedDirection);

    return {
      metric: effect.metric,
      expectedDirection: effect.expectedDirection,
      baseline,
      observed,
      delta,
      matched,
    };
  });

  // --- 副作用偵測 ---
  // 過濾掉已在 expectedEffects 中的 metrics
  const expectedMetricSet = new Set(input.expectedEffects.map(e => e.metric));

  const sideResults: SideEffectResult[] = input.sideEffectMetrics
    .filter(m => !expectedMetricSet.has(m))
    .map(metric => {
      const baseline = input.baselineSnapshot[metric] ?? 0;
      const observed = input.currentSnapshot[metric] ?? 0;
      const delta = observed - baseline;
      const severity = classifySeverity(baseline, delta);

      return {
        metric,
        baseline,
        observed,
        delta,
        severity,
        acceptable: severity !== 'significant',
      };
    });

  // --- 主要目標是否達成 ---
  const primaryObjectiveMet =
    expectedResults.length > 0 && expectedResults.every(r => r.matched);

  return {
    primaryObjectiveMet,
    expectedEffects: expectedResults,
    sideEffects: sideResults,
  };
}
