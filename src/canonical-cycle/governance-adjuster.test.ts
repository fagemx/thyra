/**
 * governance-adjuster.test.ts — Governance Adjustment Engine 測試
 *
 * 覆蓋：
 * - ADJ-02: Adjustment fires only on harmful/rollback/retune
 * - ADJ-01: Adjustment specifies target + before/after
 * - Schema validation: id, createdAt, version present
 * - All verdict x recommendation combinations
 *
 * @see docs/plan/world-cycle/TRACK_G_GOVERNANCE_ADJUSTMENT.md Step 1
 */

import { describe, it, expect } from 'vitest';
import { evaluateOutcomeForAdjustment } from './governance-adjuster';
import type { AdjustmentContext } from './governance-adjuster';
import type { OutcomeReport } from '../schemas/outcome-report';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReport(overrides: Partial<OutcomeReport> = {}): OutcomeReport {
  return {
    id: 'report_test123',
    appliedChangeId: 'change_abc',
    outcomeWindowId: 'window_xyz',
    primaryObjectiveMet: true,
    expectedEffects: [],
    sideEffects: [],
    verdict: 'neutral',
    recommendation: 'watch',
    notes: [],
    createdAt: new Date().toISOString(),
    version: 1,
    ...overrides,
  };
}

function makeContext(overrides: Partial<AdjustmentContext> = {}): AdjustmentContext {
  return {
    worldId: 'world_001',
    activeTarget: 'laws.flow_control.threshold',
    currentValue: '85',
    suggestedValue: '78',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ADJ-02: Trigger conditions
// ---------------------------------------------------------------------------

describe('evaluateOutcomeForAdjustment — ADJ-02 trigger conditions', () => {
  it('should produce adjustment for harmful verdict + rollback recommendation', () => {
    const report = makeReport({ verdict: 'harmful', recommendation: 'rollback' });
    const result = evaluateOutcomeForAdjustment(report, makeContext());

    expect(result).not.toBeNull();
    expect(result?.adjustmentType).toBe('risk_policy'); // rollback -> risk_policy
  });

  it('should produce adjustment for harmful verdict + do_not_repeat recommendation', () => {
    const report = makeReport({ verdict: 'harmful', recommendation: 'do_not_repeat' });
    const result = evaluateOutcomeForAdjustment(report, makeContext());

    expect(result).not.toBeNull();
    expect(result?.adjustmentType).toBe('law_threshold'); // harmful -> law_threshold default
  });

  it('should produce adjustment for neutral verdict + retune recommendation', () => {
    const report = makeReport({ verdict: 'neutral', recommendation: 'retune' });
    const result = evaluateOutcomeForAdjustment(report, makeContext());

    expect(result).not.toBeNull();
    expect(result?.adjustmentType).toBe('law_threshold'); // retune -> law_threshold
  });

  it('should produce adjustment for beneficial verdict + retune recommendation', () => {
    const report = makeReport({ verdict: 'beneficial', recommendation: 'retune' });
    const result = evaluateOutcomeForAdjustment(report, makeContext());

    expect(result).not.toBeNull();
  });

  it('should produce adjustment for inconclusive verdict + rollback recommendation', () => {
    const report = makeReport({ verdict: 'inconclusive', recommendation: 'rollback' });
    const result = evaluateOutcomeForAdjustment(report, makeContext());

    expect(result).not.toBeNull();
    expect(result?.adjustmentType).toBe('risk_policy'); // rollback -> risk_policy
  });
});

// ---------------------------------------------------------------------------
// ADJ-02: Non-trigger conditions
// ---------------------------------------------------------------------------

describe('evaluateOutcomeForAdjustment — ADJ-02 non-trigger conditions', () => {
  it('should NOT produce adjustment for beneficial verdict + reinforce recommendation', () => {
    const report = makeReport({ verdict: 'beneficial', recommendation: 'reinforce' });
    const result = evaluateOutcomeForAdjustment(report, makeContext());

    expect(result).toBeNull();
  });

  it('should NOT produce adjustment for neutral verdict + watch recommendation', () => {
    const report = makeReport({ verdict: 'neutral', recommendation: 'watch' });
    const result = evaluateOutcomeForAdjustment(report, makeContext());

    expect(result).toBeNull();
  });

  it('should NOT produce adjustment for inconclusive verdict + watch recommendation', () => {
    const report = makeReport({ verdict: 'inconclusive', recommendation: 'watch' });
    const result = evaluateOutcomeForAdjustment(report, makeContext());

    expect(result).toBeNull();
  });

  it('should NOT produce adjustment for neutral verdict + reinforce recommendation', () => {
    const report = makeReport({ verdict: 'neutral', recommendation: 'reinforce' });
    const result = evaluateOutcomeForAdjustment(report, makeContext());

    expect(result).toBeNull();
  });

  it('should NOT produce adjustment for beneficial verdict + do_not_repeat recommendation', () => {
    const report = makeReport({ verdict: 'beneficial', recommendation: 'do_not_repeat' });
    const result = evaluateOutcomeForAdjustment(report, makeContext());

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ADJ-01: target + before/after required
// ---------------------------------------------------------------------------

describe('evaluateOutcomeForAdjustment — ADJ-01 target + before/after', () => {
  it('should include target in adjustment (ADJ-01)', () => {
    const report = makeReport({ verdict: 'harmful', recommendation: 'rollback' });
    const context = makeContext({ activeTarget: 'laws.risk.maxBudget' });
    const result = evaluateOutcomeForAdjustment(report, context);

    expect(result).not.toBeNull();
    expect(result?.target).toBe('laws.risk.maxBudget');
  });

  it('should include before and after in adjustment (ADJ-01)', () => {
    const report = makeReport({ verdict: 'harmful', recommendation: 'rollback' });
    const context = makeContext({ currentValue: '100', suggestedValue: '75' });
    const result = evaluateOutcomeForAdjustment(report, context);

    expect(result).not.toBeNull();
    expect(result?.before).toBe('100');
    expect(result?.after).toBe('75');
  });

  it('should use context values for target/before/after', () => {
    const report = makeReport({ verdict: 'harmful', recommendation: 'rollback' });
    const context: AdjustmentContext = {
      worldId: 'world_999',
      activeTarget: 'chief.permissions.canApprove',
      currentValue: 'true',
      suggestedValue: 'false',
    };
    const result = evaluateOutcomeForAdjustment(report, context);

    expect(result?.target).toBe('chief.permissions.canApprove');
    expect(result?.before).toBe('true');
    expect(result?.after).toBe('false');
  });
});

// ---------------------------------------------------------------------------
// Schema validation: THY-04 compliance
// ---------------------------------------------------------------------------

describe('evaluateOutcomeForAdjustment — THY-04 schema validation', () => {
  it('should have id, createdAt, version (THY-04)', () => {
    const report = makeReport({ verdict: 'harmful', recommendation: 'rollback' });
    const result = evaluateOutcomeForAdjustment(report, makeContext());

    expect(result).not.toBeNull();
    expect(result?.id).toMatch(/^adj_/);
    expect(result?.createdAt).toBeDefined();
    expect(result?.version).toBe(1);
  });

  it('should have status proposed initially', () => {
    const report = makeReport({ verdict: 'harmful', recommendation: 'rollback' });
    const result = evaluateOutcomeForAdjustment(report, makeContext());

    expect(result?.status).toBe('proposed');
  });

  it('should have worldId and triggeredBy populated', () => {
    const report = makeReport({
      id: 'report_abc123',
      verdict: 'harmful',
      recommendation: 'rollback',
    });
    const context = makeContext({ worldId: 'world_xyz' });
    const result = evaluateOutcomeForAdjustment(report, context);

    expect(result?.worldId).toBe('world_xyz');
    expect(result?.triggeredBy).toBe('report_abc123');
  });

  it('should have rationale built from report', () => {
    const report = makeReport({
      verdict: 'harmful',
      recommendation: 'rollback',
      primaryObjectiveMet: false,
    });
    const result = evaluateOutcomeForAdjustment(report, makeContext());

    expect(result?.rationale).toContain('harmful');
    expect(result?.rationale).toContain('rollback');
    expect(result?.rationale).toContain('Primary objective was not met');
  });
});

// ---------------------------------------------------------------------------
// AdjustmentType inference
// ---------------------------------------------------------------------------

describe('evaluateOutcomeForAdjustment — adjustmentType inference', () => {
  it('should infer risk_policy for rollback recommendation', () => {
    const report = makeReport({ verdict: 'neutral', recommendation: 'rollback' });
    const result = evaluateOutcomeForAdjustment(report, makeContext());

    expect(result?.adjustmentType).toBe('risk_policy');
  });

  it('should infer law_threshold for harmful verdict with non-rollback recommendation', () => {
    const report = makeReport({ verdict: 'harmful', recommendation: 'do_not_repeat' });
    const result = evaluateOutcomeForAdjustment(report, makeContext());

    expect(result?.adjustmentType).toBe('law_threshold');
  });

  it('should infer law_threshold for retune recommendation', () => {
    const report = makeReport({ verdict: 'neutral', recommendation: 'retune' });
    const result = evaluateOutcomeForAdjustment(report, makeContext());

    expect(result?.adjustmentType).toBe('law_threshold');
  });

  it('should infer law_threshold when significant side effects present', () => {
    const report = makeReport({
      verdict: 'harmful',
      recommendation: 'do_not_repeat',
      sideEffects: [
        { metric: 'fairness', baseline: 100, observed: 80, delta: -20, severity: 'significant', acceptable: false },
      ],
    });
    const result = evaluateOutcomeForAdjustment(report, makeContext());

    expect(result?.adjustmentType).toBe('law_threshold');
  });
});
