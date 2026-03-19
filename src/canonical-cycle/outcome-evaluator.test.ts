/**
 * outcome-evaluator.test.ts — Outcome 評估器測試
 *
 * 覆蓋：
 * - 預期效果：improvement, degradation, no change, stable
 * - 副作用偵測：negligible, minor, significant
 * - primaryObjectiveMet 邏輯
 * - 邊界條件：baseline=0, 空 expectedEffects, 空 sideEffectMetrics
 *
 * @see docs/plan/world-cycle/TRACK_E_OUTCOME_COLLECTOR.md Step 2
 */

import { describe, it, expect } from 'vitest';
import { evaluateOutcome } from './outcome-evaluator';
import type { EvaluationInput } from './outcome-evaluator';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(overrides: Partial<EvaluationInput> = {}): EvaluationInput {
  return {
    baselineSnapshot: { revenue: 100, users: 50, latency: 200 },
    currentSnapshot: { revenue: 120, users: 55, latency: 190 },
    expectedEffects: [
      { metric: 'revenue', expectedDirection: 'up' },
    ],
    sideEffectMetrics: ['users', 'latency'],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Expected effects — direction matching
// ---------------------------------------------------------------------------

describe('evaluateOutcome — expected effects', () => {
  it('should detect improvement (metric went up as expected)', () => {
    const result = evaluateOutcome(makeInput());

    expect(result.primaryObjectiveMet).toBe(true);
    expect(result.expectedEffects).toHaveLength(1);

    const rev = result.expectedEffects[0];
    expect(rev.metric).toBe('revenue');
    expect(rev.baseline).toBe(100);
    expect(rev.observed).toBe(120);
    expect(rev.delta).toBe(20);
    expect(rev.matched).toBe(true);
  });

  it('should detect degradation (metric went opposite direction)', () => {
    const result = evaluateOutcome(makeInput({
      currentSnapshot: { revenue: 80, users: 55, latency: 190 },
    }));

    expect(result.primaryObjectiveMet).toBe(false);
    expect(result.expectedEffects[0].matched).toBe(false);
    expect(result.expectedEffects[0].delta).toBe(-20);
  });

  it('should detect no change when expecting up', () => {
    const result = evaluateOutcome(makeInput({
      currentSnapshot: { revenue: 100, users: 50, latency: 200 },
    }));

    expect(result.primaryObjectiveMet).toBe(false);
    expect(result.expectedEffects[0].matched).toBe(false);
    expect(result.expectedEffects[0].delta).toBe(0);
  });

  it('should match "down" direction correctly', () => {
    const result = evaluateOutcome(makeInput({
      expectedEffects: [{ metric: 'latency', expectedDirection: 'down' }],
    }));

    expect(result.primaryObjectiveMet).toBe(true);
    const lat = result.expectedEffects[0];
    expect(lat.metric).toBe('latency');
    expect(lat.delta).toBe(-10);
    expect(lat.matched).toBe(true);
  });

  it('should match "stable" direction (negligible change)', () => {
    const result = evaluateOutcome(makeInput({
      baselineSnapshot: { stability: 42.0 },
      currentSnapshot: { stability: 42.005 },
      expectedEffects: [{ metric: 'stability', expectedDirection: 'stable' }],
      sideEffectMetrics: [],
    }));

    expect(result.primaryObjectiveMet).toBe(true);
    expect(result.expectedEffects[0].matched).toBe(true);
  });

  it('should reject "stable" when change exceeds threshold', () => {
    const result = evaluateOutcome(makeInput({
      baselineSnapshot: { stability: 42.0 },
      currentSnapshot: { stability: 43.0 },
      expectedEffects: [{ metric: 'stability', expectedDirection: 'stable' }],
      sideEffectMetrics: [],
    }));

    expect(result.primaryObjectiveMet).toBe(false);
    expect(result.expectedEffects[0].matched).toBe(false);
  });

  it('should require ALL expected effects to match for primaryObjectiveMet', () => {
    const result = evaluateOutcome(makeInput({
      expectedEffects: [
        { metric: 'revenue', expectedDirection: 'up' },
        { metric: 'latency', expectedDirection: 'up' }, // latency went down, not up
      ],
    }));

    expect(result.primaryObjectiveMet).toBe(false);
    expect(result.expectedEffects[0].matched).toBe(true);  // revenue: up ✓
    expect(result.expectedEffects[1].matched).toBe(false);  // latency: expected up, got down ✗
  });

  it('should return primaryObjectiveMet=false when expectedEffects is empty', () => {
    const result = evaluateOutcome(makeInput({
      expectedEffects: [],
    }));

    expect(result.primaryObjectiveMet).toBe(false);
    expect(result.expectedEffects).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Side effects — detection and severity classification
// ---------------------------------------------------------------------------

describe('evaluateOutcome — side effects', () => {
  it('should classify negligible side effect (<5% change)', () => {
    const result = evaluateOutcome(makeInput({
      baselineSnapshot: { revenue: 100, cpu: 200 },
      currentSnapshot: { revenue: 120, cpu: 205 }, // cpu: 2.5% change
      sideEffectMetrics: ['cpu'],
    }));

    expect(result.sideEffects).toHaveLength(1);
    const cpu = result.sideEffects[0];
    expect(cpu.metric).toBe('cpu');
    expect(cpu.severity).toBe('negligible');
    expect(cpu.acceptable).toBe(true);
  });

  it('should classify minor side effect (5-15% change)', () => {
    const result = evaluateOutcome(makeInput({
      baselineSnapshot: { revenue: 100, memory: 200 },
      currentSnapshot: { revenue: 120, memory: 220 }, // memory: 10% change
      sideEffectMetrics: ['memory'],
    }));

    expect(result.sideEffects).toHaveLength(1);
    const mem = result.sideEffects[0];
    expect(mem.metric).toBe('memory');
    expect(mem.severity).toBe('minor');
    expect(mem.acceptable).toBe(true);
  });

  it('should classify significant side effect (>15% change)', () => {
    const result = evaluateOutcome(makeInput({
      baselineSnapshot: { revenue: 100, errors: 10 },
      currentSnapshot: { revenue: 120, errors: 15 }, // errors: 50% change
      sideEffectMetrics: ['errors'],
    }));

    expect(result.sideEffects).toHaveLength(1);
    const err = result.sideEffects[0];
    expect(err.metric).toBe('errors');
    expect(err.severity).toBe('significant');
    expect(err.acceptable).toBe(false);
    expect(err.delta).toBe(5);
  });

  it('should exclude expected effect metrics from side effects', () => {
    const result = evaluateOutcome(makeInput({
      expectedEffects: [{ metric: 'revenue', expectedDirection: 'up' }],
      sideEffectMetrics: ['revenue', 'users', 'latency'], // revenue overlaps
    }));

    // revenue should NOT appear in sideEffects (it's an expected effect)
    const sideMetrics = result.sideEffects.map(s => s.metric);
    expect(sideMetrics).not.toContain('revenue');
    expect(sideMetrics).toContain('users');
    expect(sideMetrics).toContain('latency');
  });

  it('should handle empty sideEffectMetrics', () => {
    const result = evaluateOutcome(makeInput({
      sideEffectMetrics: [],
    }));

    expect(result.sideEffects).toHaveLength(0);
  });

  it('should handle baseline=0 with non-zero observed as significant', () => {
    const result = evaluateOutcome(makeInput({
      baselineSnapshot: { revenue: 100, new_metric: 0 },
      currentSnapshot: { revenue: 120, new_metric: 5 },
      sideEffectMetrics: ['new_metric'],
    }));

    const nm = result.sideEffects[0];
    expect(nm.metric).toBe('new_metric');
    expect(nm.severity).toBe('significant');
    expect(nm.acceptable).toBe(false);
  });

  it('should handle baseline=0 with zero observed as negligible', () => {
    const result = evaluateOutcome(makeInput({
      baselineSnapshot: { revenue: 100, new_metric: 0 },
      currentSnapshot: { revenue: 120, new_metric: 0 },
      sideEffectMetrics: ['new_metric'],
    }));

    const nm = result.sideEffects[0];
    expect(nm.severity).toBe('negligible');
    expect(nm.acceptable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Edge cases — missing metrics, defaults
// ---------------------------------------------------------------------------

describe('evaluateOutcome — edge cases', () => {
  it('should default to 0 for missing baseline metric', () => {
    const result = evaluateOutcome({
      baselineSnapshot: {},
      currentSnapshot: { revenue: 100 },
      expectedEffects: [{ metric: 'revenue', expectedDirection: 'up' }],
      sideEffectMetrics: [],
    });

    expect(result.expectedEffects[0].baseline).toBe(0);
    expect(result.expectedEffects[0].observed).toBe(100);
    expect(result.expectedEffects[0].delta).toBe(100);
    expect(result.expectedEffects[0].matched).toBe(true);
  });

  it('should default to 0 for missing current metric', () => {
    const result = evaluateOutcome({
      baselineSnapshot: { revenue: 100 },
      currentSnapshot: {},
      expectedEffects: [{ metric: 'revenue', expectedDirection: 'up' }],
      sideEffectMetrics: [],
    });

    expect(result.expectedEffects[0].baseline).toBe(100);
    expect(result.expectedEffects[0].observed).toBe(0);
    expect(result.expectedEffects[0].delta).toBe(-100);
    expect(result.expectedEffects[0].matched).toBe(false);
  });

  it('should handle missing side effect metric in both snapshots', () => {
    const result = evaluateOutcome({
      baselineSnapshot: {},
      currentSnapshot: {},
      expectedEffects: [],
      sideEffectMetrics: ['phantom'],
    });

    const phantom = result.sideEffects[0];
    expect(phantom.baseline).toBe(0);
    expect(phantom.observed).toBe(0);
    expect(phantom.delta).toBe(0);
    expect(phantom.severity).toBe('negligible');
  });

  it('should handle multiple expected effects with mixed results', () => {
    const result = evaluateOutcome({
      baselineSnapshot: { a: 10, b: 20, c: 30 },
      currentSnapshot: { a: 15, b: 15, c: 30.005 },
      expectedEffects: [
        { metric: 'a', expectedDirection: 'up' },
        { metric: 'b', expectedDirection: 'down' },
        { metric: 'c', expectedDirection: 'stable' },
      ],
      sideEffectMetrics: [],
    });

    expect(result.expectedEffects[0].matched).toBe(true);  // a: up ✓
    expect(result.expectedEffects[1].matched).toBe(true);   // b: down ✓
    expect(result.expectedEffects[2].matched).toBe(true);   // c: stable ✓
    expect(result.primaryObjectiveMet).toBe(true);
  });

  it('should handle negative baseline values correctly', () => {
    const result = evaluateOutcome({
      baselineSnapshot: { balance: -100 },
      currentSnapshot: { balance: -50 },
      expectedEffects: [{ metric: 'balance', expectedDirection: 'up' }],
      sideEffectMetrics: [],
    });

    expect(result.expectedEffects[0].delta).toBe(50);
    expect(result.expectedEffects[0].matched).toBe(true);
  });
});
