/**
 * outcome-report-builder.test.ts — OutcomeReport 建構器測試
 *
 * 覆蓋：
 * - 4 種 verdict：beneficial, neutral, harmful, inconclusive
 * - 5 種 recommendation：reinforce, retune, watch, rollback, do_not_repeat
 * - notes 產生邏輯
 * - THY-04: version 欄位
 * - OutcomeReportSchema 驗證
 * - 邊界條件：空 expectedEffects, 空 sideEffects
 *
 * @see docs/plan/world-cycle/TRACK_E_OUTCOME_COLLECTOR.md Step 3
 */

import { describe, it, expect } from 'vitest';
import { OutcomeReportSchema } from '../schemas/outcome-report';
import type { EvaluationResult } from './outcome-evaluator';
import {
  buildOutcomeReport,
  determineVerdict,
  determineRecommendation,
  type BuildOutcomeReportInput,
} from './outcome-report-builder';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvalResult(overrides: Partial<EvaluationResult> = {}): EvaluationResult {
  return {
    primaryObjectiveMet: true,
    expectedEffects: [
      {
        metric: 'revenue',
        expectedDirection: 'up',
        baseline: 100,
        observed: 120,
        delta: 20,
        matched: true,
      },
    ],
    sideEffects: [
      {
        metric: 'cpu',
        baseline: 200,
        observed: 205,
        delta: 5,
        severity: 'negligible',
        acceptable: true,
      },
    ],
    ...overrides,
  };
}

function makeBuildInput(overrides: Partial<BuildOutcomeReportInput> = {}): BuildOutcomeReportInput {
  return {
    appliedChangeId: 'change-001',
    outcomeWindowId: 'window-001',
    evaluationResult: makeEvalResult(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Verdict determination
// ---------------------------------------------------------------------------

describe('determineVerdict', () => {
  it('should return beneficial when objective met and no significant side effects', () => {
    const result = makeEvalResult();
    expect(determineVerdict(result)).toBe('beneficial');
  });

  it('should return neutral when objective met but has significant side effects', () => {
    const result = makeEvalResult({
      sideEffects: [
        {
          metric: 'errors',
          baseline: 10,
          observed: 15,
          delta: 5,
          severity: 'significant',
          acceptable: false,
        },
      ],
    });
    expect(determineVerdict(result)).toBe('neutral');
  });

  it('should return harmful when objective not met and has significant side effects', () => {
    const result = makeEvalResult({
      primaryObjectiveMet: false,
      sideEffects: [
        {
          metric: 'errors',
          baseline: 10,
          observed: 15,
          delta: 5,
          severity: 'significant',
          acceptable: false,
        },
      ],
    });
    expect(determineVerdict(result)).toBe('harmful');
  });

  it('should return inconclusive when objective not met and no significant side effects', () => {
    const result = makeEvalResult({
      primaryObjectiveMet: false,
    });
    expect(determineVerdict(result)).toBe('inconclusive');
  });

  it('should return inconclusive when objective not met and side effects are empty', () => {
    const result = makeEvalResult({
      primaryObjectiveMet: false,
      sideEffects: [],
    });
    expect(determineVerdict(result)).toBe('inconclusive');
  });

  it('should return beneficial when objective met and side effects are empty', () => {
    const result = makeEvalResult({
      sideEffects: [],
    });
    expect(determineVerdict(result)).toBe('beneficial');
  });
});

// ---------------------------------------------------------------------------
// Recommendation mapping
// ---------------------------------------------------------------------------

describe('determineRecommendation', () => {
  it('should return reinforce for beneficial verdict', () => {
    const result = makeEvalResult();
    expect(determineRecommendation('beneficial', result)).toBe('reinforce');
  });

  it('should return retune for neutral verdict', () => {
    const result = makeEvalResult();
    expect(determineRecommendation('neutral', result)).toBe('retune');
  });

  it('should return watch for inconclusive verdict', () => {
    const result = makeEvalResult();
    expect(determineRecommendation('inconclusive', result)).toBe('watch');
  });

  it('should return rollback for harmful verdict with significant side effects', () => {
    const result = makeEvalResult({
      primaryObjectiveMet: false,
      sideEffects: [
        {
          metric: 'errors',
          baseline: 10,
          observed: 15,
          delta: 5,
          severity: 'significant',
          acceptable: false,
        },
      ],
    });
    expect(determineRecommendation('harmful', result)).toBe('rollback');
  });

  it('should return do_not_repeat for harmful verdict with only minor side effects', () => {
    const result = makeEvalResult({
      primaryObjectiveMet: false,
      sideEffects: [
        {
          metric: 'memory',
          baseline: 200,
          observed: 220,
          delta: 20,
          severity: 'minor',
          acceptable: true,
        },
      ],
    });
    expect(determineRecommendation('harmful', result)).toBe('do_not_repeat');
  });

  it('should return do_not_repeat for harmful verdict with no side effects', () => {
    const result = makeEvalResult({
      primaryObjectiveMet: false,
      sideEffects: [],
    });
    expect(determineRecommendation('harmful', result)).toBe('do_not_repeat');
  });
});

// ---------------------------------------------------------------------------
// buildOutcomeReport — full report
// ---------------------------------------------------------------------------

describe('buildOutcomeReport', () => {
  it('should build a valid OutcomeReport for beneficial case', () => {
    const report = buildOutcomeReport(makeBuildInput());

    expect(report.verdict).toBe('beneficial');
    expect(report.recommendation).toBe('reinforce');
    expect(report.primaryObjectiveMet).toBe(true);
    expect(report.appliedChangeId).toBe('change-001');
    expect(report.outcomeWindowId).toBe('window-001');
  });

  it('should pass OutcomeReportSchema validation', () => {
    const report = buildOutcomeReport(makeBuildInput());
    const parsed = OutcomeReportSchema.safeParse(report);
    expect(parsed.success).toBe(true);
  });

  it('should have version field (THY-04)', () => {
    const report = buildOutcomeReport(makeBuildInput());
    expect(report.version).toBe(1);
  });

  it('should have id and createdAt fields', () => {
    const report = buildOutcomeReport(makeBuildInput());
    expect(report.id).toBeTruthy();
    expect(report.createdAt).toBeTruthy();
    // id should be a UUID
    expect(report.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('should generate unique ids', () => {
    const r1 = buildOutcomeReport(makeBuildInput());
    const r2 = buildOutcomeReport(makeBuildInput());
    expect(r1.id).not.toBe(r2.id);
  });

  it('should populate notes array with summary', () => {
    const report = buildOutcomeReport(makeBuildInput());
    expect(report.notes.length).toBeGreaterThan(0);
    expect(report.notes.some(n => n.includes('Expected effects'))).toBe(true);
    expect(report.notes.some(n => n.includes('Verdict'))).toBe(true);
  });

  it('should carry through expectedEffects and sideEffects from evaluation', () => {
    const evalResult = makeEvalResult();
    const report = buildOutcomeReport(makeBuildInput({ evaluationResult: evalResult }));

    expect(report.expectedEffects).toEqual(evalResult.expectedEffects);
    expect(report.sideEffects).toEqual(evalResult.sideEffects);
  });

  it('should build harmful + rollback report', () => {
    const report = buildOutcomeReport(makeBuildInput({
      evaluationResult: makeEvalResult({
        primaryObjectiveMet: false,
        expectedEffects: [
          {
            metric: 'revenue',
            expectedDirection: 'up',
            baseline: 100,
            observed: 80,
            delta: -20,
            matched: false,
          },
        ],
        sideEffects: [
          {
            metric: 'errors',
            baseline: 10,
            observed: 25,
            delta: 15,
            severity: 'significant',
            acceptable: false,
          },
        ],
      }),
    }));

    expect(report.verdict).toBe('harmful');
    expect(report.recommendation).toBe('rollback');
    expect(report.primaryObjectiveMet).toBe(false);
  });

  it('should build inconclusive + watch report', () => {
    const report = buildOutcomeReport(makeBuildInput({
      evaluationResult: makeEvalResult({
        primaryObjectiveMet: false,
        sideEffects: [],
      }),
    }));

    expect(report.verdict).toBe('inconclusive');
    expect(report.recommendation).toBe('watch');
  });

  it('should build neutral + retune report', () => {
    const report = buildOutcomeReport(makeBuildInput({
      evaluationResult: makeEvalResult({
        primaryObjectiveMet: true,
        sideEffects: [
          {
            metric: 'memory',
            baseline: 100,
            observed: 150,
            delta: 50,
            severity: 'significant',
            acceptable: false,
          },
        ],
      }),
    }));

    expect(report.verdict).toBe('neutral');
    expect(report.recommendation).toBe('retune');
  });

  it('should note significant side effects in notes', () => {
    const report = buildOutcomeReport(makeBuildInput({
      evaluationResult: makeEvalResult({
        sideEffects: [
          {
            metric: 'errors',
            baseline: 10,
            observed: 25,
            delta: 15,
            severity: 'significant',
            acceptable: false,
          },
        ],
      }),
    }));

    expect(report.notes.some(n => n.includes('Significant side effects'))).toBe(true);
    expect(report.notes.some(n => n.includes('errors'))).toBe(true);
  });

  it('should note minor side effects in notes', () => {
    const report = buildOutcomeReport(makeBuildInput({
      evaluationResult: makeEvalResult({
        sideEffects: [
          {
            metric: 'memory',
            baseline: 200,
            observed: 220,
            delta: 20,
            severity: 'minor',
            acceptable: true,
          },
        ],
      }),
    }));

    expect(report.notes.some(n => n.includes('Minor side effects'))).toBe(true);
    expect(report.notes.some(n => n.includes('memory'))).toBe(true);
  });

  it('should handle empty expected effects', () => {
    const report = buildOutcomeReport(makeBuildInput({
      evaluationResult: makeEvalResult({
        primaryObjectiveMet: false,
        expectedEffects: [],
        sideEffects: [],
      }),
    }));

    expect(report.verdict).toBe('inconclusive');
    expect(report.recommendation).toBe('watch');
    expect(report.notes.some(n => n.includes('No expected effects defined'))).toBe(true);
  });

  it('should handle no side effects with note', () => {
    const report = buildOutcomeReport(makeBuildInput({
      evaluationResult: makeEvalResult({
        sideEffects: [],
      }),
    }));

    expect(report.notes.some(n => n.includes('No side effects detected'))).toBe(true);
  });
});
