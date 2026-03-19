/**
 * governance-adjuster.test.ts — 治理調整引擎測試
 *
 * 覆蓋：
 * - ADJ-02: 只在 harmful / rollback / retune 時觸發
 * - ADJ-01: target + before/after 必填
 * - 所有 verdict x recommendation 組合的觸發/不觸發判定
 * - Schema 驗證（id, createdAt, version）
 * - adjustmentType 推導邏輯
 *
 * @see docs/world-design-v0/shared-types.md §6.11
 */

import { describe, it, expect } from 'vitest';
import type { OutcomeReport } from '../schemas/outcome-report';
import { GovernanceAdjustmentSchema } from '../schemas/governance-adjustment';
import {
  evaluateOutcomeForAdjustment,
  shouldTriggerAdjustment,
} from './governance-adjuster';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOutcomeReport(
  overrides: Partial<OutcomeReport> = {},
): OutcomeReport {
  return {
    id: 'outcome-001',
    appliedChangeId: 'change-001',
    outcomeWindowId: 'window-001',
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
    sideEffects: [],
    verdict: 'beneficial',
    recommendation: 'reinforce',
    notes: ['Expected effects: 1/1 matched', 'Verdict: beneficial'],
    createdAt: '2026-03-19T00:00:00.000Z',
    version: 1,
    ...overrides,
  };
}

const WORLD_ID = 'world-test-001';

// ---------------------------------------------------------------------------
// shouldTriggerAdjustment — ADJ-02
// ---------------------------------------------------------------------------

describe('shouldTriggerAdjustment (ADJ-02)', () => {
  it('returns true for harmful verdict', () => {
    const report = makeOutcomeReport({ verdict: 'harmful', recommendation: 'do_not_repeat' });
    expect(shouldTriggerAdjustment(report)).toBe(true);
  });

  it('returns true for rollback recommendation', () => {
    const report = makeOutcomeReport({ verdict: 'neutral', recommendation: 'rollback' });
    expect(shouldTriggerAdjustment(report)).toBe(true);
  });

  it('returns true for retune recommendation', () => {
    const report = makeOutcomeReport({ verdict: 'neutral', recommendation: 'retune' });
    expect(shouldTriggerAdjustment(report)).toBe(true);
  });

  it('returns false for beneficial + reinforce', () => {
    const report = makeOutcomeReport({ verdict: 'beneficial', recommendation: 'reinforce' });
    expect(shouldTriggerAdjustment(report)).toBe(false);
  });

  it('returns false for neutral + watch', () => {
    const report = makeOutcomeReport({ verdict: 'neutral', recommendation: 'watch' });
    expect(shouldTriggerAdjustment(report)).toBe(false);
  });

  it('returns false for inconclusive + watch', () => {
    const report = makeOutcomeReport({ verdict: 'inconclusive', recommendation: 'watch' });
    expect(shouldTriggerAdjustment(report)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// evaluateOutcomeForAdjustment — main function
// ---------------------------------------------------------------------------

describe('evaluateOutcomeForAdjustment', () => {
  // --- 不觸發的情況 ---

  it('returns null for beneficial + reinforce (no adjustment needed)', () => {
    const report = makeOutcomeReport({
      verdict: 'beneficial',
      recommendation: 'reinforce',
    });
    expect(evaluateOutcomeForAdjustment(report, WORLD_ID)).toBeNull();
  });

  it('returns null for neutral + watch', () => {
    const report = makeOutcomeReport({
      verdict: 'neutral',
      recommendation: 'watch',
    });
    expect(evaluateOutcomeForAdjustment(report, WORLD_ID)).toBeNull();
  });

  it('returns null for inconclusive + watch', () => {
    const report = makeOutcomeReport({
      verdict: 'inconclusive',
      recommendation: 'watch',
    });
    expect(evaluateOutcomeForAdjustment(report, WORLD_ID)).toBeNull();
  });

  // --- 觸發的情況 ---

  it('produces adjustment for harmful + rollback', () => {
    const report = makeOutcomeReport({
      verdict: 'harmful',
      recommendation: 'rollback',
      primaryObjectiveMet: false,
      expectedEffects: [
        { metric: 'revenue', expectedDirection: 'up', baseline: 100, observed: 80, delta: -20, matched: false },
      ],
      sideEffects: [
        { metric: 'customer_satisfaction', baseline: 90, observed: 60, delta: -30, severity: 'significant', acceptable: false },
      ],
      notes: ['Expected effects: 0/1 matched', 'Significant side effects: customer_satisfaction'],
    });

    const result = evaluateOutcomeForAdjustment(report, WORLD_ID);

    expect(result).not.toBeNull();
    expect(result!.triggeredBy).toBe('outcome-001');
    expect(result!.worldId).toBe(WORLD_ID);
    expect(result!.adjustmentType).toBe('law_threshold');
    expect(result!.status).toBe('proposed');
  });

  it('produces adjustment for harmful + do_not_repeat', () => {
    const report = makeOutcomeReport({
      verdict: 'harmful',
      recommendation: 'do_not_repeat',
      primaryObjectiveMet: false,
    });

    const result = evaluateOutcomeForAdjustment(report, WORLD_ID);

    expect(result).not.toBeNull();
    expect(result!.adjustmentType).toBe('simulation_policy');
  });

  it('produces adjustment for neutral + retune', () => {
    const report = makeOutcomeReport({
      verdict: 'neutral',
      recommendation: 'retune',
    });

    const result = evaluateOutcomeForAdjustment(report, WORLD_ID);

    expect(result).not.toBeNull();
    expect(result!.adjustmentType).toBe('risk_policy');
  });

  // --- ADJ-01: target + before/after ---

  it('always includes target (ADJ-01)', () => {
    const report = makeOutcomeReport({
      verdict: 'harmful',
      recommendation: 'rollback',
      primaryObjectiveMet: false,
    });

    const result = evaluateOutcomeForAdjustment(report, WORLD_ID);

    expect(result).not.toBeNull();
    expect(result!.target).toBe('change-001'); // appliedChangeId
    expect(result!.target.length).toBeGreaterThan(0);
  });

  it('always includes before/after (ADJ-01)', () => {
    const report = makeOutcomeReport({
      verdict: 'harmful',
      recommendation: 'rollback',
      primaryObjectiveMet: false,
    });

    const result = evaluateOutcomeForAdjustment(report, WORLD_ID);

    expect(result).not.toBeNull();
    expect(result!.before.length).toBeGreaterThan(0);
    expect(result!.after.length).toBeGreaterThan(0);
  });

  // --- Schema validation ---

  it('produces valid GovernanceAdjustment (schema passes)', () => {
    const report = makeOutcomeReport({
      verdict: 'harmful',
      recommendation: 'rollback',
      primaryObjectiveMet: false,
    });

    const result = evaluateOutcomeForAdjustment(report, WORLD_ID);
    expect(result).not.toBeNull();

    // Re-parse through schema — should not throw
    const parsed = GovernanceAdjustmentSchema.parse(result);
    expect(parsed.id).toBeTruthy();
    expect(parsed.createdAt).toBeTruthy();
    expect(parsed.version).toBe(1);
  });

  it('includes rationale from notes', () => {
    const notes = ['Expected effects: 0/1 matched', 'Verdict: harmful'];
    const report = makeOutcomeReport({
      verdict: 'harmful',
      recommendation: 'rollback',
      primaryObjectiveMet: false,
      notes,
    });

    const result = evaluateOutcomeForAdjustment(report, WORLD_ID);

    expect(result).not.toBeNull();
    expect(result!.rationale).toContain('Expected effects: 0/1 matched');
    expect(result!.rationale).toContain('Verdict: harmful');
  });

  // --- Edge case: harmful verdict triggers even with non-rollback/retune recommendation ---

  it('triggers for harmful + any recommendation (harmful always triggers)', () => {
    // harmful + do_not_repeat (not rollback or retune, but harmful = always triggers)
    const report = makeOutcomeReport({
      verdict: 'harmful',
      recommendation: 'do_not_repeat',
      primaryObjectiveMet: false,
    });

    const result = evaluateOutcomeForAdjustment(report, WORLD_ID);
    expect(result).not.toBeNull();
  });
});
