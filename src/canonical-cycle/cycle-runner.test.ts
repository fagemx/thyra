/**
 * cycle-runner.test.ts — Cycle orchestrator 測試
 *
 * 驗證 10-stage 循環、失敗處理、stage 順序、artifact 記錄。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'bun:sqlite';
import type { CycleStageHandlers, CycleRunDb } from './cycle-runner';
import { orchestrateCycle } from './cycle-runner';
import type { WorldState } from '../world/state';
import { CycleRunSchema } from '../schemas/cycle-run';

// ---------------------------------------------------------------------------
// DB setup
// ---------------------------------------------------------------------------

const CYCLE_RUNS_DDL = `CREATE TABLE cycle_runs (
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
  created_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
)`;

// ---------------------------------------------------------------------------
// Noop handlers — 所有 stage 成功，回傳最小合規資料
// ---------------------------------------------------------------------------

function makeNoopHandlers(): CycleStageHandlers {
  return {
    observe: async () => ({
      id: 'obs_batch_1',
      worldId: 'w1',
      observations: [],
      createdAt: new Date().toISOString(),
      version: 1,
    }),
    propose: async () => [
      {
        id: 'prop_1',
        worldId: 'w1',
        chiefId: 'chief_1',
        changeKind: 'adjust_stall_capacity',
        targetType: 'stall',
        targetId: 'stall_1',
        intent: 'test intent',
        diff: { before: {}, after: {} },
        status: 'proposed',
        riskLevel: 'low',
        createdAt: new Date().toISOString(),
        version: 1,
      } as never, // CanonicalChangeProposal has many fields; cast for testing
    ],
    judge: async () => [{ proposalId: 'prop_1', approved: true }],
    apply: async () => [{ proposalId: 'prop_1', appliedChangeId: 'change_1' }],
    pulse: async () => ({ pulseFrameId: 'pf_1' }),
    outcome: async () => ({ outcomeReportIds: ['out_1'] }),
    precedent: async () => ({ precedentIds: ['prec_1'] }),
    adjust: async () => ({ adjustmentIds: ['adj_1'] }),
  };
}

const STUB_WORLD_STATE = {} as WorldState;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CycleRunner orchestration', () => {
  let db: Database;
  let dbAdapter: CycleRunDb;

  beforeEach(() => {
    db = new Database(':memory:');
    db.run(CYCLE_RUNS_DDL);
    dbAdapter = {
      run: (sql: string, params: unknown[]) => {
        const stmt = db.prepare(sql);
        stmt.run(...(params as [null]));
      },
    };
  });

  it('completes full cycle with all 10 stages (idle → complete)', async () => {
    const handlers = makeNoopHandlers();
    const run = await orchestrateCycle(dbAdapter, 'w1', STUB_WORLD_STATE, handlers);

    expect(run.currentStage).toBe('complete');
    expect(run.completedAt).toBeTruthy();
    expect(run.failedAt).toBeNull();
    expect(run.failedStage).toBeNull();
    expect(run.failureReason).toBeNull();
  });

  it('records all stage timestamps (CYCLE-02)', async () => {
    const handlers = makeNoopHandlers();
    const run = await orchestrateCycle(dbAdapter, 'w1', STUB_WORLD_STATE, handlers);

    // 8 active stages should have start + complete timestamps
    const activeStages = ['observe', 'propose', 'judge', 'apply', 'pulse', 'outcome', 'precedent', 'adjust'] as const;
    for (const stage of activeStages) {
      const startKey = `${stage}StartedAt` as keyof typeof run;
      const completeKey = `${stage}CompletedAt` as keyof typeof run;
      expect(run[startKey]).toBeTruthy();
      expect(run[completeKey]).toBeTruthy();
    }
  });

  it('records artifact IDs from stage outputs', async () => {
    const handlers = makeNoopHandlers();
    const run = await orchestrateCycle(dbAdapter, 'w1', STUB_WORLD_STATE, handlers);

    expect(run.observationBatchId).toBe('obs_batch_1');
    expect(run.proposalIds).toEqual(['prop_1']);
    expect(run.judgmentReportIds).toEqual(['prop_1']);
    expect(run.appliedChangeIds).toEqual(['change_1']);
    expect(run.pulseFrameId).toBe('pf_1');
  });

  it('marks cycle as failed when observe stage throws', async () => {
    const handlers = makeNoopHandlers();
    handlers.observe = async () => {
      throw new Error('sensor offline');
    };

    const run = await orchestrateCycle(dbAdapter, 'w1', STUB_WORLD_STATE, handlers);

    expect(run.currentStage).toBe('failed');
    expect(run.failedStage).toBe('observe');
    expect(run.failureReason).toContain('sensor offline');
    expect(run.failedAt).toBeTruthy();
    expect(run.completedAt).toBeNull();
  });

  it('marks cycle as failed when propose stage throws', async () => {
    const handlers = makeNoopHandlers();
    handlers.propose = async () => {
      throw new Error('chief unavailable');
    };

    const run = await orchestrateCycle(dbAdapter, 'w1', STUB_WORLD_STATE, handlers);

    expect(run.currentStage).toBe('failed');
    expect(run.failedStage).toBe('propose');
    expect(run.failureReason).toContain('chief unavailable');
  });

  it('marks cycle as failed when judge stage throws', async () => {
    const handlers = makeNoopHandlers();
    handlers.judge = async () => {
      throw new Error('invariant violation');
    };

    const run = await orchestrateCycle(dbAdapter, 'w1', STUB_WORLD_STATE, handlers);

    expect(run.currentStage).toBe('failed');
    expect(run.failedStage).toBe('judge');
    expect(run.failureReason).toContain('invariant violation');
  });

  it('marks cycle as failed when apply stage throws', async () => {
    const handlers = makeNoopHandlers();
    handlers.apply = async () => {
      throw new Error('apply conflict');
    };

    const run = await orchestrateCycle(dbAdapter, 'w1', STUB_WORLD_STATE, handlers);

    expect(run.currentStage).toBe('failed');
    expect(run.failedStage).toBe('apply');
  });

  it('marks cycle as failed when a late stage (adjust) throws', async () => {
    const handlers = makeNoopHandlers();
    handlers.adjust = async () => {
      throw new Error('adjustment rejected');
    };

    const run = await orchestrateCycle(dbAdapter, 'w1', STUB_WORLD_STATE, handlers);

    expect(run.currentStage).toBe('failed');
    expect(run.failedStage).toBe('adjust');
    // Earlier stages should still have timestamps
    expect(run.observeStartedAt).toBeTruthy();
    expect(run.pulseCompletedAt).toBeTruthy();
  });

  it('does not execute stages after failure', async () => {
    const executionLog: string[] = [];
    const handlers = makeNoopHandlers();

    // Wrap each handler to log execution
    const originalPropose = handlers.propose;
    handlers.observe = async (...args) => {
      executionLog.push('observe');
      return makeNoopHandlers().observe(...args);
    };
    handlers.propose = async () => {
      executionLog.push('propose');
      return originalPropose('w1', {
        id: 'obs_batch_1',
        worldId: 'w1',
        observations: [],
        createdAt: new Date().toISOString(),
        version: 1,
      });
    };
    handlers.judge = async () => {
      executionLog.push('judge');
      throw new Error('fail at judge');
    };
    handlers.apply = async () => {
      executionLog.push('apply');
      return [];
    };

    await orchestrateCycle(dbAdapter, 'w1', STUB_WORLD_STATE, handlers);

    expect(executionLog).toContain('observe');
    expect(executionLog).toContain('propose');
    expect(executionLog).toContain('judge');
    expect(executionLog).not.toContain('apply');
  });

  it('persists cycle run to SQLite after each stage', async () => {
    const handlers = makeNoopHandlers();
    await orchestrateCycle(dbAdapter, 'w1', STUB_WORLD_STATE, handlers);

    const row = db.prepare('SELECT * FROM cycle_runs WHERE world_id = ?').get('w1') as Record<string, unknown>;
    expect(row).toBeTruthy();
    expect(row['current_stage']).toBe('complete');
    expect(row['completed_at']).toBeTruthy();
    expect(row['observe_started_at']).toBeTruthy();
    expect(row['observe_completed_at']).toBeTruthy();
    expect(row['adjust_completed_at']).toBeTruthy();
  });

  it('persists failed cycle to SQLite', async () => {
    const handlers = makeNoopHandlers();
    handlers.pulse = async () => {
      throw new Error('pulse broadcast failed');
    };

    await orchestrateCycle(dbAdapter, 'w1', STUB_WORLD_STATE, handlers);

    const row = db.prepare('SELECT * FROM cycle_runs WHERE world_id = ?').get('w1') as Record<string, unknown>;
    expect(row).toBeTruthy();
    expect(row['current_stage']).toBe('failed');
    expect(row['failed_stage']).toBe('pulse');
    expect(row['failure_reason']).toContain('pulse broadcast failed');
    expect(row['failed_at']).toBeTruthy();
  });

  it('CycleRun passes Zod validation after successful cycle', async () => {
    const handlers = makeNoopHandlers();
    const run = await orchestrateCycle(dbAdapter, 'w1', STUB_WORLD_STATE, handlers);

    const result = CycleRunSchema.safeParse(run);
    expect(result.success).toBe(true);
  });

  it('CycleRun passes Zod validation after failed cycle', async () => {
    const handlers = makeNoopHandlers();
    handlers.judge = async () => {
      throw new Error('validation error');
    };

    const run = await orchestrateCycle(dbAdapter, 'w1', STUB_WORLD_STATE, handlers);

    const result = CycleRunSchema.safeParse(run);
    expect(result.success).toBe(true);
  });

  it('stage handlers receive correct arguments from previous stages', async () => {
    const received: Record<string, unknown[]> = {};
    const handlers: CycleStageHandlers = {
      observe: async (worldId, _state) => {
        received['observe'] = [worldId];
        return {
          id: 'obs_42',
          worldId,
          observations: [],
          createdAt: new Date().toISOString(),
          version: 1,
        };
      },
      propose: async (worldId, observations) => {
        received['propose'] = [worldId, observations.id];
        return [];
      },
      judge: async (worldId, proposals) => {
        received['judge'] = [worldId, proposals.length];
        return [];
      },
      apply: async (worldId, approved) => {
        received['apply'] = [worldId, approved.length];
        return [];
      },
      pulse: async (worldId) => {
        received['pulse'] = [worldId];
        return { pulseFrameId: 'pf_2' };
      },
      outcome: async (worldId, appliedIds) => {
        received['outcome'] = [worldId, appliedIds];
        return { outcomeReportIds: [] };
      },
      precedent: async (worldId, outcomes) => {
        received['precedent'] = [worldId, outcomes];
        return { precedentIds: [] };
      },
      adjust: async (worldId, outcomes) => {
        received['adjust'] = [worldId, outcomes];
        return { adjustmentIds: [] };
      },
    };

    const run = await orchestrateCycle(dbAdapter, 'w1', STUB_WORLD_STATE, handlers);
    expect(run.currentStage).toBe('complete');

    // observe receives worldId
    expect(received['observe']).toEqual(['w1']);
    // propose receives the observation batch id
    expect(received['propose']?.[1]).toBe('obs_42');
    // judge receives empty proposals array
    expect(received['judge']?.[1]).toBe(0);
    // apply receives 0 approved (no judgments approved nothing)
    expect(received['apply']?.[1]).toBe(0);
    // outcome receives appliedIds (empty array since no approvals)
    expect(received['outcome']?.[1]).toEqual([]);
  });

  it('filters only approved proposals for apply stage', async () => {
    let appliedProposals: unknown[] = [];
    const handlers: CycleStageHandlers = {
      observe: async () => ({
        id: 'obs_1',
        worldId: 'w1',
        observations: [],
        createdAt: new Date().toISOString(),
        version: 1,
      }),
      propose: async () => [
        { id: 'p1' } as never,
        { id: 'p2' } as never,
        { id: 'p3' } as never,
      ],
      judge: async () => [
        { proposalId: 'p1', approved: true },
        { proposalId: 'p2', approved: false },
        { proposalId: 'p3', approved: true },
      ],
      apply: async (_worldId, approved) => {
        appliedProposals = approved;
        return approved.map(p => ({ proposalId: p.id, appliedChangeId: `ch_${p.id}` }));
      },
      pulse: async () => ({ pulseFrameId: 'pf_1' }),
      outcome: async () => ({ outcomeReportIds: [] }),
      precedent: async () => ({ precedentIds: [] }),
      adjust: async () => ({ adjustmentIds: [] }),
    };

    const run = await orchestrateCycle(dbAdapter, 'w1', STUB_WORLD_STATE, handlers);
    expect(run.currentStage).toBe('complete');

    // Only p1 and p3 should be approved
    const ids = (appliedProposals as Array<{ id: string }>).map(p => p.id);
    expect(ids).toEqual(['p1', 'p3']);
    expect(run.appliedChangeIds).toEqual(['ch_p1', 'ch_p3']);
  });
});
