import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from 'bun:sqlite';
import {
  advanceCycleStage,
  failCycleAtStage,
  getNextStage,
  getStageOrder,
} from './cycle-state-machine';
import { CycleStageSchema, CycleRunSchema } from '../schemas/cycle-run';
import type { CycleStage } from '../schemas/cycle-run';

// ---------------------------------------------------------------------------
// CycleStageSchema validation
// ---------------------------------------------------------------------------

describe('CycleStageSchema', () => {
  it('validates all 11 stage values', () => {
    const stages = [
      'idle', 'observe', 'propose', 'judge', 'apply',
      'pulse', 'outcome', 'precedent', 'adjust', 'complete', 'failed',
    ];
    for (const s of stages) {
      expect(CycleStageSchema.safeParse(s).success).toBe(true);
    }
  });

  it('rejects invalid stage values', () => {
    expect(CycleStageSchema.safeParse('invalid').success).toBe(false);
    expect(CycleStageSchema.safeParse('').success).toBe(false);
    expect(CycleStageSchema.safeParse(42).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CycleRunSchema validation
// ---------------------------------------------------------------------------

describe('CycleRunSchema', () => {
  const validRun = {
    id: 'cycle_w1_1',
    worldId: 'w1',
    cycleNumber: 1,
    currentStage: 'complete' as const,
    observeStartedAt: '2026-03-19T00:00:00Z',
    observeCompletedAt: '2026-03-19T00:01:00Z',
    proposeStartedAt: '2026-03-19T00:01:00Z',
    proposeCompletedAt: '2026-03-19T00:02:00Z',
    judgeStartedAt: '2026-03-19T00:02:00Z',
    judgeCompletedAt: '2026-03-19T00:03:00Z',
    applyStartedAt: '2026-03-19T00:03:00Z',
    applyCompletedAt: '2026-03-19T00:04:00Z',
    pulseStartedAt: '2026-03-19T00:04:00Z',
    pulseCompletedAt: '2026-03-19T00:05:00Z',
    outcomeStartedAt: '2026-03-19T00:05:00Z',
    outcomeCompletedAt: '2026-03-19T00:06:00Z',
    precedentStartedAt: '2026-03-19T00:06:00Z',
    precedentCompletedAt: '2026-03-19T00:07:00Z',
    adjustStartedAt: '2026-03-19T00:07:00Z',
    adjustCompletedAt: '2026-03-19T00:08:00Z',
    startedAt: '2026-03-19T00:00:00Z',
    completedAt: '2026-03-19T00:08:00Z',
    failedAt: null,
    failedStage: null,
    failureReason: null,
    observationBatchId: 'ob1',
    proposalIds: ['p1', 'p2'],
    judgmentReportIds: ['j1'],
    appliedChangeIds: ['ac1'],
    pulseFrameId: 'pf1',
    created_at: '2026-03-19T00:00:00Z',
    version: 1,
  };

  it('validates a complete CycleRun', () => {
    const result = CycleRunSchema.safeParse(validRun);
    expect(result.success).toBe(true);
  });

  it('validates a CycleRun with null timestamps (idle)', () => {
    const idle = {
      ...validRun,
      currentStage: 'idle',
      observeStartedAt: null,
      observeCompletedAt: null,
      proposeStartedAt: null,
      proposeCompletedAt: null,
      judgeStartedAt: null,
      judgeCompletedAt: null,
      applyStartedAt: null,
      applyCompletedAt: null,
      pulseStartedAt: null,
      pulseCompletedAt: null,
      outcomeStartedAt: null,
      outcomeCompletedAt: null,
      precedentStartedAt: null,
      precedentCompletedAt: null,
      adjustStartedAt: null,
      adjustCompletedAt: null,
      completedAt: null,
      observationBatchId: null,
      proposalIds: [],
      judgmentReportIds: [],
      appliedChangeIds: [],
      pulseFrameId: null,
    };
    expect(CycleRunSchema.safeParse(idle).success).toBe(true);
  });

  it('validates a failed CycleRun', () => {
    const failed = {
      ...validRun,
      currentStage: 'failed',
      completedAt: null,
      failedAt: '2026-03-19T00:03:00Z',
      failedStage: 'judge',
      failureReason: 'invariant violation',
    };
    expect(CycleRunSchema.safeParse(failed).success).toBe(true);
  });

  it('defaults version to 1', () => {
    const { version: _v, ...noVersion } = validRun;
    const result = CycleRunSchema.safeParse(noVersion);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe(1);
    }
  });

  it('rejects missing required fields', () => {
    expect(CycleRunSchema.safeParse({}).success).toBe(false);
    expect(CycleRunSchema.safeParse({ id: 'x' }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// advanceCycleStage — CYCLE-01 enforcement
// ---------------------------------------------------------------------------

describe('advanceCycleStage', () => {
  it('advances idle -> observe', () => {
    expect(advanceCycleStage('idle', 'observe')).toBe('observe');
  });

  it('advances through full sequence', () => {
    const stages = getStageOrder();
    let current: CycleStage = stages[0]; // 'idle'
    for (let i = 1; i < stages.length; i++) {
      current = advanceCycleStage(current, stages[i]);
      expect(current).toBe(stages[i]);
    }
    expect(current).toBe('complete');
  });

  it('rejects skipping stages (CYCLE-01)', () => {
    expect(() => advanceCycleStage('idle', 'judge')).toThrow(
      /Invalid cycle stage transition/,
    );
    expect(() => advanceCycleStage('observe', 'apply')).toThrow(
      /Invalid cycle stage transition/,
    );
    expect(() => advanceCycleStage('pulse', 'complete')).toThrow(
      /Invalid cycle stage transition/,
    );
  });

  it('rejects backward transitions', () => {
    expect(() => advanceCycleStage('judge', 'observe')).toThrow(
      /Invalid cycle stage transition/,
    );
  });

  it('rejects advancing from failed (terminal)', () => {
    expect(() => advanceCycleStage('failed', 'observe')).toThrow(
      /Cannot advance a failed cycle/,
    );
  });

  it('rejects advancing from complete (terminal)', () => {
    expect(() => advanceCycleStage('complete', 'observe')).toThrow(
      /Cycle already complete/,
    );
  });

  it('includes expected next stage in error message', () => {
    try {
      advanceCycleStage('idle', 'judge');
    } catch (e) {
      expect((e as Error).message).toContain('Expected next stage: observe');
    }
  });
});

// ---------------------------------------------------------------------------
// failCycleAtStage
// ---------------------------------------------------------------------------

describe('failCycleAtStage', () => {
  it('returns structured failure', () => {
    const result = failCycleAtStage('judge', 'invariant violation');
    expect(result.stage).toBe('failed');
    expect(result.failedStage).toBe('judge');
    expect(result.reason).toBe('invariant violation');
  });

  it('captures any stage as failedStage', () => {
    const stages: CycleStage[] = ['observe', 'propose', 'apply', 'pulse', 'outcome'];
    for (const s of stages) {
      const result = failCycleAtStage(s, 'test');
      expect(result.failedStage).toBe(s);
    }
  });
});

// ---------------------------------------------------------------------------
// getNextStage
// ---------------------------------------------------------------------------

describe('getNextStage', () => {
  it('returns observe after idle', () => {
    expect(getNextStage('idle')).toBe('observe');
  });

  it('returns complete after adjust', () => {
    expect(getNextStage('adjust')).toBe('complete');
  });

  it('returns null for complete', () => {
    expect(getNextStage('complete')).toBeNull();
  });

  it('returns null for failed', () => {
    expect(getNextStage('failed')).toBeNull();
  });

  it('returns correct successor for each non-terminal stage', () => {
    const order = getStageOrder();
    for (let i = 0; i < order.length - 1; i++) {
      expect(getNextStage(order[i])).toBe(order[i + 1]);
    }
  });
});

// ---------------------------------------------------------------------------
// getStageOrder
// ---------------------------------------------------------------------------

describe('getStageOrder', () => {
  it('returns 10 stages', () => {
    expect(getStageOrder()).toHaveLength(10);
  });

  it('starts with idle and ends with complete', () => {
    const order = getStageOrder();
    expect(order[0]).toBe('idle');
    expect(order[order.length - 1]).toBe('complete');
  });

  it('does not include failed', () => {
    expect(getStageOrder()).not.toContain('failed');
  });
});

// ---------------------------------------------------------------------------
// DB table: cycle_runs
// ---------------------------------------------------------------------------

describe('cycle_runs DB table', () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.run(`
      CREATE TABLE IF NOT EXISTS cycle_runs (
        id TEXT PRIMARY KEY,
        world_id TEXT NOT NULL,
        cycle_number INTEGER NOT NULL,
        current_stage TEXT NOT NULL DEFAULT 'idle',
        observe_started_at TEXT,
        observe_completed_at TEXT,
        propose_started_at TEXT,
        propose_completed_at TEXT,
        judge_started_at TEXT,
        judge_completed_at TEXT,
        apply_started_at TEXT,
        apply_completed_at TEXT,
        pulse_started_at TEXT,
        pulse_completed_at TEXT,
        outcome_started_at TEXT,
        outcome_completed_at TEXT,
        precedent_started_at TEXT,
        precedent_completed_at TEXT,
        adjust_started_at TEXT,
        adjust_completed_at TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        failed_at TEXT,
        failed_stage TEXT,
        failure_reason TEXT,
        observation_batch_id TEXT,
        proposal_ids TEXT NOT NULL DEFAULT '[]',
        judgment_report_ids TEXT NOT NULL DEFAULT '[]',
        applied_change_ids TEXT NOT NULL DEFAULT '[]',
        pulse_frame_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        version INTEGER NOT NULL DEFAULT 1
      )
    `);
  });

  it('inserts and retrieves a cycle run', () => {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO cycle_runs (id, world_id, cycle_number, current_stage, started_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('cr1', 'w1', 1, 'idle', now, now);

    const row = db.prepare('SELECT * FROM cycle_runs WHERE id = ?').get('cr1') as Record<string, unknown>;
    expect(row).toBeTruthy();
    expect(row['world_id']).toBe('w1');
    expect(row['current_stage']).toBe('idle');
    expect(row['cycle_number']).toBe(1);
  });

  it('stores stage timestamps', () => {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO cycle_runs (id, world_id, cycle_number, current_stage, started_at, observe_started_at, observe_completed_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('cr2', 'w1', 1, 'propose', now, now, now, now);

    const row = db.prepare('SELECT observe_started_at, observe_completed_at FROM cycle_runs WHERE id = ?').get('cr2') as Record<string, unknown>;
    expect(row['observe_started_at']).toBe(now);
    expect(row['observe_completed_at']).toBe(now);
  });

  it('stores JSON array columns', () => {
    const now = new Date().toISOString();
    const proposalIds = JSON.stringify(['p1', 'p2']);
    db.prepare(`
      INSERT INTO cycle_runs (id, world_id, cycle_number, current_stage, started_at, proposal_ids, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('cr3', 'w1', 1, 'idle', now, proposalIds, now);

    const row = db.prepare('SELECT proposal_ids FROM cycle_runs WHERE id = ?').get('cr3') as Record<string, unknown>;
    expect(JSON.parse(row['proposal_ids'] as string)).toEqual(['p1', 'p2']);
  });

  it('stores failure information', () => {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO cycle_runs (id, world_id, cycle_number, current_stage, started_at, failed_at, failed_stage, failure_reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('cr4', 'w1', 1, 'failed', now, now, 'judge', 'invariant violation', now);

    const row = db.prepare('SELECT current_stage, failed_stage, failure_reason FROM cycle_runs WHERE id = ?').get('cr4') as Record<string, unknown>;
    expect(row['current_stage']).toBe('failed');
    expect(row['failed_stage']).toBe('judge');
    expect(row['failure_reason']).toBe('invariant violation');
  });
});
