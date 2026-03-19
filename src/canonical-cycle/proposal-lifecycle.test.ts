import { describe, it, expect } from 'vitest';
import {
  transitionProposalStatus,
  isValidTransition,
  getValidNextStatuses,
} from './proposal-lifecycle';
import {
  CanonicalChangeProposalSchema,
  ChangeProposalStatusSchema,
} from '../schemas/canonical-proposal';
import type { ChangeProposalStatus } from '../schemas/canonical-proposal';

// ---------------------------------------------------------------------------
// Helper: 完整的 CanonicalChangeProposal fixture
// ---------------------------------------------------------------------------

function makeProposalFixture(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: 'cp_001',
    worldId: 'world_1',
    cycleId: 'cycle_1',
    status: 'draft',
    kind: 'adjust_stall_capacity',
    title: 'Increase north gate capacity',
    summary: 'North gate congestion detected; raise capacity by 20%',
    target: {
      scope: 'stall',
      objectIds: ['stall_north_1'],
      blastRadius: 'local',
    },
    intent: {
      objective: 'Reduce congestion at north gate',
      reason: 'Metric threshold exceeded for 15 minutes',
      urgency: 'medium',
      timeHorizon: 'immediate',
      triggerType: 'metric_threshold',
    },
    diff: {
      mode: 'patch',
      operations: [
        { op: 'inc', path: 'capacity', delta: 20, unit: 'slots' },
      ],
    },
    governance: {
      requestedRiskClass: 'low',
      autoApplyEligible: true,
      simulationRequired: false,
      humanApprovalRequired: false,
      invariantsChecked: ['SI-1'],
      rollbackPlan: {
        strategy: 'inverse_patch',
        rollbackScope: 'proposal_only',
        rollbackWindowMinutes: 30,
      },
    },
    expectedOutcome: {
      hypotheses: ['North gate queue length drops below 10'],
      watchedMetrics: [
        { metric: 'north_gate_queue_length', direction: 'down', expectedDelta: -15 },
      ],
      expectedDirection: 'improve',
      outcomeWindow: {
        openForMinutes: 30,
        evaluationAt: null,
      },
    },
    trace: {
      sourceObservations: ['obs_001'],
    },
    createdAt: '2026-03-19T12:00:00Z',
    createdBy: { type: 'chief', chiefId: 'chief_market_1' },
    version: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProposalLifecycle — state machine', () => {
  // --- Valid transitions ---
  it('draft → proposed is valid', () => {
    expect(transitionProposalStatus('draft', 'proposed')).toBe('proposed');
  });

  it('draft → cancelled is valid', () => {
    expect(transitionProposalStatus('draft', 'cancelled')).toBe('cancelled');
  });

  it('proposed → judged is valid', () => {
    expect(transitionProposalStatus('proposed', 'judged')).toBe('judged');
  });

  it('judged → approved is valid', () => {
    expect(transitionProposalStatus('judged', 'approved')).toBe('approved');
  });

  it('judged → approved_with_constraints is valid', () => {
    expect(transitionProposalStatus('judged', 'approved_with_constraints'))
      .toBe('approved_with_constraints');
  });

  it('judged → rejected is valid', () => {
    expect(transitionProposalStatus('judged', 'rejected')).toBe('rejected');
  });

  it('approved → applied is valid', () => {
    expect(transitionProposalStatus('approved', 'applied')).toBe('applied');
  });

  it('applied → outcome_window_open is valid', () => {
    expect(transitionProposalStatus('applied', 'outcome_window_open'))
      .toBe('outcome_window_open');
  });

  it('applied → rolled_back is valid', () => {
    expect(transitionProposalStatus('applied', 'rolled_back')).toBe('rolled_back');
  });

  it('outcome_window_open → outcome_closed is valid', () => {
    expect(transitionProposalStatus('outcome_window_open', 'outcome_closed'))
      .toBe('outcome_closed');
  });

  it('outcome_closed → archived is valid', () => {
    expect(transitionProposalStatus('outcome_closed', 'archived')).toBe('archived');
  });

  it('simulation_required → judged (re-judge) is valid', () => {
    expect(transitionProposalStatus('simulation_required', 'judged')).toBe('judged');
  });

  it('escalated → judged (re-judge after human input) is valid', () => {
    expect(transitionProposalStatus('escalated', 'judged')).toBe('judged');
  });

  it('deferred → proposed (re-submit) is valid', () => {
    expect(transitionProposalStatus('deferred', 'proposed')).toBe('proposed');
  });

  // --- Full lifecycle path ---
  it('full happy path: draft → proposed → judged → approved → applied → outcome_window_open → outcome_closed → archived', () => {
    const path: ChangeProposalStatus[] = [
      'draft', 'proposed', 'judged', 'approved', 'applied',
      'outcome_window_open', 'outcome_closed', 'archived',
    ];
    for (let i = 0; i < path.length - 1; i++) {
      expect(transitionProposalStatus(path[i], path[i + 1])).toBe(path[i + 1]);
    }
  });

  // --- Invalid transitions ---
  it('draft → applied throws (no skipping)', () => {
    expect(() => transitionProposalStatus('draft', 'applied')).toThrow('Invalid proposal transition');
  });

  it('archived → draft throws (terminal state)', () => {
    expect(() => transitionProposalStatus('archived', 'draft')).toThrow('Invalid proposal transition');
  });

  it('proposed → applied throws (must go through judged)', () => {
    expect(() => transitionProposalStatus('proposed', 'applied')).toThrow('Invalid proposal transition');
  });

  it('judged → applied throws (must go through approved first)', () => {
    expect(() => transitionProposalStatus('judged', 'applied')).toThrow('Invalid proposal transition');
  });

  it('approved → archived throws (must go through applied)', () => {
    expect(() => transitionProposalStatus('approved', 'archived')).toThrow('Invalid proposal transition');
  });

  it('draft → judged throws (must go through proposed)', () => {
    expect(() => transitionProposalStatus('draft', 'judged')).toThrow('Invalid proposal transition');
  });

  // --- All 6 verdicts reachable from judged ---
  it('judged can transition to all 6 verdict statuses', () => {
    const verdicts: ChangeProposalStatus[] = [
      'approved', 'approved_with_constraints', 'rejected',
      'simulation_required', 'escalated', 'deferred',
    ];
    for (const v of verdicts) {
      expect(isValidTransition('judged', v)).toBe(true);
    }
  });

  it('judged cannot transition to non-verdict statuses', () => {
    const nonVerdicts: ChangeProposalStatus[] = [
      'draft', 'proposed', 'applied', 'cancelled', 'archived',
    ];
    for (const v of nonVerdicts) {
      expect(isValidTransition('judged', v)).toBe(false);
    }
  });

  // --- getValidNextStatuses ---
  it('getValidNextStatuses returns correct list for draft', () => {
    expect(getValidNextStatuses('draft')).toEqual(['proposed', 'cancelled']);
  });

  it('getValidNextStatuses returns empty for archived (terminal)', () => {
    expect(getValidNextStatuses('archived')).toEqual([]);
  });

  it('getValidNextStatuses returns 6 verdicts for judged', () => {
    expect(getValidNextStatuses('judged')).toHaveLength(6);
  });
});

describe('CanonicalChangeProposal — schema validation', () => {
  it('ChangeProposalStatus has exactly 15 values', () => {
    const values = ChangeProposalStatusSchema.options;
    expect(values).toHaveLength(15);
  });

  it('validates a complete proposal with all 7 layers', () => {
    const result = CanonicalChangeProposalSchema.safeParse(makeProposalFixture());
    expect(result.success).toBe(true);
  });

  it('rejects proposal missing required identity field (worldId)', () => {
    const fixture = makeProposalFixture();
    delete (fixture as Record<string, unknown>).worldId;
    const result = CanonicalChangeProposalSchema.safeParse(fixture);
    expect(result.success).toBe(false);
  });

  it('rejects proposal missing target layer', () => {
    const fixture = makeProposalFixture();
    delete (fixture as Record<string, unknown>).target;
    const result = CanonicalChangeProposalSchema.safeParse(fixture);
    expect(result.success).toBe(false);
  });

  it('rejects proposal missing governance layer', () => {
    const fixture = makeProposalFixture();
    delete (fixture as Record<string, unknown>).governance;
    const result = CanonicalChangeProposalSchema.safeParse(fixture);
    expect(result.success).toBe(false);
  });

  it('rejects proposal missing expectedOutcome layer', () => {
    const fixture = makeProposalFixture();
    delete (fixture as Record<string, unknown>).expectedOutcome;
    const result = CanonicalChangeProposalSchema.safeParse(fixture);
    expect(result.success).toBe(false);
  });

  it('rejects proposal missing trace layer', () => {
    const fixture = makeProposalFixture();
    delete (fixture as Record<string, unknown>).trace;
    const result = CanonicalChangeProposalSchema.safeParse(fixture);
    expect(result.success).toBe(false);
  });

  it('rejects invalid status value', () => {
    const result = CanonicalChangeProposalSchema.safeParse(
      makeProposalFixture({ status: 'invalid_status' }),
    );
    expect(result.success).toBe(false);
  });

  it('accepts chief author type', () => {
    const result = CanonicalChangeProposalSchema.safeParse(
      makeProposalFixture({ createdBy: { type: 'chief', chiefId: 'c1' } }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts human author type', () => {
    const result = CanonicalChangeProposalSchema.safeParse(
      makeProposalFixture({ createdBy: { type: 'human', userId: 'u1' } }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts system author type', () => {
    const result = CanonicalChangeProposalSchema.safeParse(
      makeProposalFixture({ createdBy: { type: 'system', source: 'auto-scaler' } }),
    );
    expect(result.success).toBe(true);
  });

  it('defaults version to 1 when omitted', () => {
    const fixture = makeProposalFixture();
    delete (fixture as Record<string, unknown>).version;
    const result = CanonicalChangeProposalSchema.safeParse(fixture);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe(1);
    }
  });
});
