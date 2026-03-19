import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { initSchema } from '../db';
import { CycleRunSchema } from '../schemas/cycle-run';
import type { ObservationBatch } from '../schemas/observation';
import type { CanonicalChangeProposal } from '../schemas/canonical-proposal';
import type { WorldState } from '../world/state';
import {
  orchestrateCycle,
  type CycleStageHandlers,
  type JudgmentResult,
  type ApplyResult,
  type PulseResult,
  type OutcomeResult,
  type PrecedentResult,
  type AdjustResult,
} from './cycle-runner';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createTestDb(): Database {
  const db = new Database(':memory:');
  initSchema(db);
  return db;
}

/** Minimal WorldState stub for testing */
function createStubWorldState(): WorldState {
  return {
    village: {
      id: 'v1',
      name: 'test-village',
      description: '',
      target_repo: 'test/repo',
      status: 'active',
      metadata: {},
      version: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    constitution: null,
    chiefs: [],
    active_laws: [],
    skills: [],
    running_cycles: [],
    goals: [],
    assembled_at: new Date().toISOString(),
  };
}

/** Minimal ObservationBatch for testing */
function createStubBatch(id = 'ob1'): ObservationBatch {
  return {
    id,
    worldId: 'v1',
    observations: [],
    createdAt: new Date().toISOString(),
    version: 1,
  };
}

/** Minimal CanonicalChangeProposal stub */
function createStubProposal(id: string): CanonicalChangeProposal {
  return {
    id,
    worldId: 'v1',
    cycleId: 'cr_test',
    status: 'proposed',
    kind: 'adjust_stall_capacity',
    title: `Proposal ${id}`,
    summary: 'test proposal',
    target: {
      scope: 'world',
      objectIds: ['v1'],
      blastRadius: 'local',
    },
    intent: {
      objective: 'test',
      reason: 'test',
      urgency: 'low',
      timeHorizon: 'immediate',
      triggerType: 'scheduled_review',
    },
    diff: {
      mode: 'patch',
      operations: [],
    },
    governance: {
      requestedRiskClass: 'low',
      autoApplyEligible: true,
      simulationRequired: false,
      humanApprovalRequired: false,
      rollbackPlan: {
        strategy: 'inverse_patch',
        rollbackScope: 'proposal_only',
        rollbackWindowMinutes: 60,
      },
    },
    expectedOutcome: {
      hypotheses: ['test'],
      watchedMetrics: [],
      expectedDirection: 'improve',
      outcomeWindow: { openForMinutes: 30, evaluationAt: null },
    },
    trace: {
      sourceObservations: [],
    },
    createdAt: new Date().toISOString(),
    createdBy: { type: 'system', source: 'test' },
    version: 1,
  };
}

/** Create noop handlers that return minimal valid data */
function createNoopHandlers(overrides?: Partial<CycleStageHandlers>): CycleStageHandlers {
  return {
    observe: async (_worldId: string, _state: WorldState): Promise<ObservationBatch> =>
      createStubBatch('ob1'),
    propose: async (_worldId: string, _obs: ObservationBatch): Promise<CanonicalChangeProposal[]> =>
      [createStubProposal('p1')],
    judge: async (_worldId: string, _proposals: CanonicalChangeProposal[]): Promise<JudgmentResult[]> =>
      [{ proposalId: 'p1', approved: true, reportId: 'jr1', reason: 'ok' }],
    apply: async (_worldId: string, _approved: CanonicalChangeProposal[]): Promise<ApplyResult[]> =>
      [{ proposalId: 'p1', changeId: 'ch1', applied: true }],
    pulse: async (_worldId: string): Promise<PulseResult> =>
      ({ pulseFrameId: 'pf1' }),
    outcome: async (_worldId: string, _appliedIds: string[]): Promise<OutcomeResult> =>
      ({ appliedChangeIds: ['ch1'], summary: 'ok' }),
    precedent: async (_worldId: string, _outcomes: OutcomeResult): Promise<PrecedentResult> =>
      ({ recorded: true, precedentId: 'prec1' }),
    adjust: async (_worldId: string, _outcomes: OutcomeResult): Promise<AdjustResult> =>
      ({ adjusted: false, adjustments: [] }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('orchestrateCycle', () => {
  let db: Database;
  let worldState: WorldState;

  beforeEach(() => {
    db = createTestDb();
    worldState = createStubWorldState();
  });

  it('completes full cycle with noop handlers', async () => {
    const handlers = createNoopHandlers();
    const run = await orchestrateCycle(db, 'v1', worldState, handlers);

    expect(run.currentStage).toBe('complete');
    expect(run.completedAt).toBeTruthy();
    expect(run.failedAt).toBeNull();
    expect(run.failedStage).toBeNull();
    expect(run.cycleNumber).toBe(1);
  });

  it('marks cycle as failed when a stage throws', async () => {
    const handlers = createNoopHandlers({
      propose: async () => { throw new Error('chief unavailable'); },
    });
    const run = await orchestrateCycle(db, 'v1', worldState, handlers);

    expect(run.currentStage).toBe('failed');
    expect(run.failedStage).toBe('propose');
    expect(run.failureReason).toBe('chief unavailable');
    expect(run.failedAt).toBeTruthy();
    expect(run.completedAt).toBeNull();
  });

  it('records observation batch ID from observe stage', async () => {
    const handlers = createNoopHandlers({
      observe: async () => createStubBatch('obs_special'),
    });
    const run = await orchestrateCycle(db, 'v1', worldState, handlers);

    expect(run.observationBatchId).toBe('obs_special');
  });

  it('records proposal IDs from propose stage', async () => {
    const handlers = createNoopHandlers({
      propose: async () => [createStubProposal('px1'), createStubProposal('px2')],
      judge: async () => [
        { proposalId: 'px1', approved: true, reportId: 'jr1', reason: 'ok' },
        { proposalId: 'px2', approved: true, reportId: 'jr2', reason: 'ok' },
      ],
      apply: async () => [
        { proposalId: 'px1', changeId: 'ch1', applied: true },
        { proposalId: 'px2', changeId: 'ch2', applied: true },
      ],
    });
    const run = await orchestrateCycle(db, 'v1', worldState, handlers);

    expect(run.proposalIds).toEqual(['px1', 'px2']);
  });

  it('passes observations to propose handler', async () => {
    const captured: ObservationBatch[] = [];
    const specialBatch = createStubBatch('obs_capture');
    specialBatch.observations = [{
      id: 'obs_1',
      source: 'state_diff',
      timestamp: new Date().toISOString(),
      scope: 'world',
      importance: 'high',
      summary: 'test observation',
    }];

    const handlers = createNoopHandlers({
      observe: async () => specialBatch,
      propose: async (_worldId: string, obs: ObservationBatch) => {
        captured.push(obs);
        return [createStubProposal('p1')];
      },
    });

    await orchestrateCycle(db, 'v1', worldState, handlers);

    expect(captured).toHaveLength(1);
    expect(captured[0].id).toBe('obs_capture');
    expect(captured[0].observations).toHaveLength(1);
  });

  it('passes only approved proposals to apply handler', async () => {
    let capturedApproved: CanonicalChangeProposal[] = [];

    const handlers = createNoopHandlers({
      propose: async () => [
        createStubProposal('approved_one'),
        createStubProposal('rejected_one'),
        createStubProposal('approved_two'),
      ],
      judge: async () => [
        { proposalId: 'approved_one', approved: true, reportId: 'jr1', reason: 'ok' },
        { proposalId: 'rejected_one', approved: false, reportId: 'jr2', reason: 'too risky' },
        { proposalId: 'approved_two', approved: true, reportId: 'jr3', reason: 'ok' },
      ],
      apply: async (_worldId: string, approved: CanonicalChangeProposal[]) => {
        capturedApproved = approved;
        return approved.map(p => ({ proposalId: p.id, changeId: `ch_${p.id}`, applied: true }));
      },
    });

    await orchestrateCycle(db, 'v1', worldState, handlers);

    expect(capturedApproved).toHaveLength(2);
    expect(capturedApproved.map(p => p.id)).toEqual(['approved_one', 'approved_two']);
  });

  it('auto-increments cycle number', async () => {
    const handlers = createNoopHandlers();

    const run1 = await orchestrateCycle(db, 'v1', worldState, handlers);
    const run2 = await orchestrateCycle(db, 'v1', worldState, handlers);

    expect(run1.cycleNumber).toBe(1);
    expect(run2.cycleNumber).toBe(2);
  });

  it('persists cycle run to DB after completion', async () => {
    const handlers = createNoopHandlers();
    const run = await orchestrateCycle(db, 'v1', worldState, handlers);

    const row = db.prepare('SELECT * FROM cycle_runs WHERE id = ?').get(run.id) as Record<string, unknown>;
    expect(row).toBeTruthy();
    expect(row.current_stage).toBe('complete');
    expect(row.world_id).toBe('v1');
    expect(row.cycle_number).toBe(1);
  });

  it('CycleRun validates against Zod schema', async () => {
    const handlers = createNoopHandlers();
    const run = await orchestrateCycle(db, 'v1', worldState, handlers);

    const result = CycleRunSchema.safeParse(run);
    expect(result.success).toBe(true);
  });

  it('stops executing stages after failure', async () => {
    let proposeCalled = false;
    let judgeCalled = false;

    const handlers = createNoopHandlers({
      observe: async () => { throw new Error('network timeout'); },
      propose: async () => {
        proposeCalled = true;
        return [];
      },
      judge: async () => {
        judgeCalled = true;
        return [];
      },
    });

    const run = await orchestrateCycle(db, 'v1', worldState, handlers);

    expect(run.currentStage).toBe('failed');
    expect(run.failedStage).toBe('observe');
    expect(proposeCalled).toBe(false);
    expect(judgeCalled).toBe(false);
  });
});
