/**
 * canonical-cycle/outcome-report-builder.ts — OutcomeReport 建構器
 *
 * 從 EvaluationResult 建構完整的 OutcomeReport：
 * - 判定 verdict：beneficial / neutral / harmful / inconclusive
 * - 映射 recommendation：reinforce / retune / watch / rollback / do_not_repeat
 * - 產生摘要 notes
 *
 * CONTRACT: THY-04 — OutcomeReport 必須有 id, created_at, version
 *
 * @see docs/plan/world-cycle/TRACK_E_OUTCOME_COLLECTOR.md Step 3
 */

import { randomUUID } from 'crypto';
import {
  OutcomeReportSchema,
  type OutcomeReport,
  type OutcomeVerdict,
  type OutcomeRecommendation,
} from '../schemas/outcome-report';
import type { EvaluationResult } from './outcome-evaluator';

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface BuildOutcomeReportInput {
  appliedChangeId: string;
  outcomeWindowId: string;
  evaluationResult: EvaluationResult;
}

// ---------------------------------------------------------------------------
// Verdict determination
// ---------------------------------------------------------------------------

/**
 * 判定 outcome verdict
 *
 * - beneficial: 主目標達成 且 無 significant 副作用
 * - neutral: 主目標達成 但 有 significant 副作用（混合結果）
 * - harmful: 主目標未達成 且 有 significant 副作用
 * - inconclusive: 主目標未達成 但 無 significant 副作用（只是沒效果）
 */
export function determineVerdict(result: EvaluationResult): OutcomeVerdict {
  const hasSignificantSideEffects = result.sideEffects.some(
    s => s.severity === 'significant',
  );

  if (result.primaryObjectiveMet) {
    return hasSignificantSideEffects ? 'neutral' : 'beneficial';
  }

  return hasSignificantSideEffects ? 'harmful' : 'inconclusive';
}

// ---------------------------------------------------------------------------
// Recommendation mapping
// ---------------------------------------------------------------------------

/**
 * 從 verdict + 副作用嚴重度映射建議動作
 *
 * - beneficial -> reinforce
 * - neutral -> retune（目標達成但副作用需調整）
 * - harmful + significant -> rollback
 * - harmful + minor only -> do_not_repeat
 * - inconclusive -> watch
 */
export function determineRecommendation(
  verdict: OutcomeVerdict,
  result: EvaluationResult,
): OutcomeRecommendation {
  switch (verdict) {
    case 'beneficial':
      return 'reinforce';
    case 'neutral':
      return 'retune';
    case 'inconclusive':
      return 'watch';
    case 'harmful': {
      const hasSignificant = result.sideEffects.some(
        s => s.severity === 'significant',
      );
      return hasSignificant ? 'rollback' : 'do_not_repeat';
    }
  }
}

// ---------------------------------------------------------------------------
// Notes generation
// ---------------------------------------------------------------------------

/**
 * 產生摘要 notes
 */
function buildNotes(result: EvaluationResult, verdict: OutcomeVerdict): string[] {
  const notes: string[] = [];

  // 主目標摘要
  const matched = result.expectedEffects.filter(e => e.matched).length;
  const total = result.expectedEffects.length;
  if (total > 0) {
    notes.push(`Expected effects: ${matched}/${total} matched`);
  } else {
    notes.push('No expected effects defined');
  }

  // 副作用摘要
  const significant = result.sideEffects.filter(s => s.severity === 'significant');
  const minor = result.sideEffects.filter(s => s.severity === 'minor');
  if (significant.length > 0) {
    notes.push(
      `Significant side effects: ${significant.map(s => s.metric).join(', ')}`,
    );
  }
  if (minor.length > 0) {
    notes.push(`Minor side effects: ${minor.map(s => s.metric).join(', ')}`);
  }
  if (result.sideEffects.length === 0) {
    notes.push('No side effects detected');
  }

  // Verdict 摘要
  notes.push(`Verdict: ${verdict}`);

  return notes;
}

// ---------------------------------------------------------------------------
// Main builder function
// ---------------------------------------------------------------------------

/**
 * 建構完整的 OutcomeReport
 *
 * 從 EvaluationResult 產生 verdict、recommendation 和 notes，
 * 組合成完整的 OutcomeReport 並通過 Zod schema 驗證。
 */
export function buildOutcomeReport(input: BuildOutcomeReportInput): OutcomeReport {
  const { appliedChangeId, outcomeWindowId, evaluationResult } = input;

  const verdict = determineVerdict(evaluationResult);
  const recommendation = determineRecommendation(verdict, evaluationResult);
  const notes = buildNotes(evaluationResult, verdict);

  return OutcomeReportSchema.parse({
    id: randomUUID(),
    appliedChangeId,
    outcomeWindowId,
    primaryObjectiveMet: evaluationResult.primaryObjectiveMet,
    expectedEffects: evaluationResult.expectedEffects,
    sideEffects: evaluationResult.sideEffects,
    verdict,
    recommendation,
    notes,
    createdAt: new Date().toISOString(),
    version: 1,
  });
}
