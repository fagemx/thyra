# Track C: Cycle Runner

> Batch 2（依賴 Track B，blocks E/F/G/H）
> Repo: `C:\ai_agent\thyra`
> Layer: L2 循環層
> Spec: `docs/world-design-v0/canonical-cycle.md` §4 (10 stages), §12 (MVP cadence)

## 核心設計

Build the canonical 10-stage cycle orchestrator. The cycle runner ties observe → propose → judge → apply → pulse → outcome → precedent → adjust → complete into a repeatable, timed governance loop.

This is the convergence point — it depends on Track A (observations) and Track B (proposals/judgment), and blocks all downstream tracks (E/F/G/H).

Key constraint (CYCLE-01): stages execute in fixed order. No stage can be skipped or reordered.

---

## Step 1: CycleRun Zod Schema + State Machine

**Files**:
- `src/schemas/cycle-run.ts`
- `src/canonical-cycle/cycle-state-machine.ts`

**Reference**: `canonical-cycle.md` §4 (10 stages), CONTRACT.md CYCLE-01/02

**Key changes**:

1. Create `src/schemas/cycle-run.ts`:
```ts
import { z } from 'zod';

export const CycleStageSchema = z.enum([
  'idle',
  'observe',
  'propose',
  'judge',
  'apply',
  'pulse',
  'outcome',
  'precedent',
  'adjust',
  'complete',
  'failed',
]);
export type CycleStage = z.infer<typeof CycleStageSchema>;

export const CycleRunSchema = z.object({
  id: z.string(),
  worldId: z.string(),
  cycleNumber: z.number(),
  currentStage: CycleStageSchema,

  // Stage timestamps — null until that stage completes
  observeStartedAt: z.string().nullable(),
  observeCompletedAt: z.string().nullable(),
  proposeStartedAt: z.string().nullable(),
  proposeCompletedAt: z.string().nullable(),
  judgeStartedAt: z.string().nullable(),
  judgeCompletedAt: z.string().nullable(),
  applyStartedAt: z.string().nullable(),
  applyCompletedAt: z.string().nullable(),
  pulseStartedAt: z.string().nullable(),
  pulseCompletedAt: z.string().nullable(),
  outcomeStartedAt: z.string().nullable(),
  outcomeCompletedAt: z.string().nullable(),
  precedentStartedAt: z.string().nullable(),
  precedentCompletedAt: z.string().nullable(),
  adjustStartedAt: z.string().nullable(),
  adjustCompletedAt: z.string().nullable(),

  // Metadata
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  failedAt: z.string().nullable(),
  failedStage: CycleStageSchema.nullable(),
  failureReason: z.string().nullable(),

  // Artifact references
  observationBatchId: z.string().nullable(),
  proposalIds: z.array(z.string()),
  judgmentReportIds: z.array(z.string()),
  appliedChangeIds: z.array(z.string()),
  pulseFrameId: z.string().nullable(),

  created_at: z.string(),
  version: z.number().default(1),
});
export type CycleRun = z.infer<typeof CycleRunSchema>;
```

2. Create `src/canonical-cycle/cycle-state-machine.ts`:
```ts
import type { CycleStage } from '../schemas/cycle-run';

/**
 * Fixed stage order per CYCLE-01.
 * The cycle MUST progress through these stages in order.
 */
const STAGE_ORDER: readonly CycleStage[] = [
  'idle',
  'observe',
  'propose',
  'judge',
  'apply',
  'pulse',
  'outcome',
  'precedent',
  'adjust',
  'complete',
] as const;

/**
 * Advance the cycle to the next stage.
 * Throws if the requested next stage is not the immediate successor.
 */
export function advanceCycleStage(
  current: CycleStage,
  next: CycleStage,
): CycleStage {
  if (current === 'failed') {
    throw new Error('Cannot advance a failed cycle');
  }
  if (current === 'complete') {
    throw new Error('Cycle already complete');
  }

  const currentIdx = STAGE_ORDER.indexOf(current);
  const nextIdx = STAGE_ORDER.indexOf(next);

  if (nextIdx !== currentIdx + 1) {
    throw new Error(
      `Invalid cycle stage transition: ${current} → ${next}. ` +
      `Expected next stage: ${STAGE_ORDER[currentIdx + 1]}`
    );
  }

  return next;
}

/**
 * Mark a cycle as failed at the current stage.
 */
export function failCycleAtStage(
  current: CycleStage,
  reason: string,
): { stage: 'failed'; failedStage: CycleStage; reason: string } {
  return {
    stage: 'failed',
    failedStage: current,
    reason,
  };
}

/**
 * Get the next expected stage in the cycle.
 * Returns null if the cycle is complete or failed.
 */
export function getNextStage(current: CycleStage): CycleStage | null {
  if (current === 'failed' || current === 'complete') return null;
  const idx = STAGE_ORDER.indexOf(current);
  return idx < STAGE_ORDER.length - 1 ? STAGE_ORDER[idx + 1] : null;
}

/** Get all stages in canonical order */
export function getStageOrder(): readonly CycleStage[] {
  return STAGE_ORDER;
}
```

3. DB table (add to schema init):
```sql
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
);
```

**Acceptance criteria**:
- [ ] CycleRun has timestamp pairs (start/complete) for all 8 active stages
- [ ] `advanceCycleStage('idle', 'observe')` succeeds
- [ ] `advanceCycleStage('idle', 'judge')` throws (no skipping — CYCLE-01)
- [ ] `advanceCycleStage('complete', 'observe')` throws (terminal)
- [ ] `advanceCycleStage('failed', 'observe')` throws (terminal)
- [ ] `failCycleAtStage('judge', 'invariant violation')` returns structured failure
- [ ] CycleRun Zod schema validates correctly
- [ ] DB table `cycle_runs` stores all stage timestamps

```bash
bun run build   # zero errors
```

**Git commit**: `feat(canonical-cycle): add CycleRun schema and cycle state machine`

---

## Step 2: Cycle Orchestrator (10 Stages)

**Files**:
- `src/canonical-cycle/cycle-runner.ts`

**Reference**: `canonical-cycle.md` §4 (full stage descriptions), §9 (engineering shape)

**Key changes**:

1. Create `src/canonical-cycle/cycle-runner.ts`:
```ts
import type { Database } from 'bun:sqlite';
import type { CycleRun, CycleStage } from '../schemas/cycle-run';
import type { WorldState } from '../world/state';
import type { ObservationBatch } from '../schemas/observation';
import type { CanonicalChangeProposal } from '../schemas/change-proposal';
import { advanceCycleStage, failCycleAtStage } from './cycle-state-machine';

// --- Stage handler interfaces ---
export interface CycleStageHandlers {
  observe: (worldId: string, currentState: WorldState) => Promise<ObservationBatch>;
  propose: (worldId: string, observations: ObservationBatch) => Promise<CanonicalChangeProposal[]>;
  judge: (worldId: string, proposals: CanonicalChangeProposal[]) => Promise<JudgmentResult[]>;
  apply: (worldId: string, approved: CanonicalChangeProposal[]) => Promise<ApplyResult[]>;
  pulse: (worldId: string) => Promise<PulseResult>;
  outcome: (worldId: string, appliedIds: string[]) => Promise<OutcomeResult>;
  precedent: (worldId: string, outcomes: OutcomeResult) => Promise<PrecedentResult>;
  adjust: (worldId: string, outcomes: OutcomeResult) => Promise<AdjustResult>;
}

// Placeholder result types — will be refined by downstream tracks
// ⚠️ 以下 placeholder types 在 Track D-G 實作後應替換為真實型別：
// JudgmentResult → JudgeResult (from src/world/judge.ts)
// PulseResult → PulseFrame (from shared-types.md §6.8)
// OutcomeResult → OutcomeReport (from shared-types.md §6.9)
// PrecedentResult → PrecedentRecord (from shared-types.md §6.10)
// AdjustResult → GovernanceAdjustment (from shared-types.md §6.11)
export interface JudgmentResult { proposalId: string; approved: boolean }
export interface ApplyResult { proposalId: string; appliedChangeId: string }
export interface PulseResult { pulseFrameId: string }
export interface OutcomeResult { outcomeReportIds: string[] }
export interface PrecedentResult { precedentIds: string[] }
export interface AdjustResult { adjustmentIds: string[] }

/**
 * Orchestrate one complete governance cycle.
 *
 * Runs all 10 stages in fixed order (CYCLE-01).
 * If any stage fails, marks the cycle as failed with the stage name.
 */
export async function orchestrateCycle(
  db: Database,
  worldId: string,
  currentState: WorldState,
  handlers: CycleStageHandlers,
): Promise<CycleRun> {
  const cycleId = `cycle_${worldId}_${Date.now()}`;
  const now = new Date().toISOString();

  const run: CycleRun = createInitialCycleRun(cycleId, worldId, now);
  saveCycleRun(db, run);

  const stages: Array<{
    name: CycleStage;
    execute: () => Promise<void>;
  }> = [
    {
      name: 'observe',
      execute: async () => {
        const batch = await handlers.observe(worldId, currentState);
        run.observationBatchId = batch.id;
      },
    },
    {
      name: 'propose',
      execute: async () => {
        const proposals = await handlers.propose(worldId, /* observations */);
        run.proposalIds = proposals.map(p => p.id);
      },
    },
    {
      name: 'judge',
      execute: async () => {
        const results = await handlers.judge(worldId, /* proposals */);
        run.judgmentReportIds = results.map(r => r.proposalId);
      },
    },
    {
      name: 'apply',
      execute: async () => {
        const results = await handlers.apply(worldId, /* approved proposals */);
        run.appliedChangeIds = results.map(r => r.appliedChangeId);
      },
    },
    {
      name: 'pulse',
      execute: async () => {
        const result = await handlers.pulse(worldId);
        run.pulseFrameId = result.pulseFrameId;
      },
    },
    {
      name: 'outcome',
      execute: async () => {
        await handlers.outcome(worldId, run.appliedChangeIds);
      },
    },
    {
      name: 'precedent',
      execute: async () => {
        await handlers.precedent(worldId, /* outcome result */);
      },
    },
    {
      name: 'adjust',
      execute: async () => {
        await handlers.adjust(worldId, /* outcome result */);
      },
    },
  ];

  for (const stage of stages) {
    try {
      run.currentStage = advanceCycleStage(run.currentStage, stage.name);
      setStageTimestamp(run, stage.name, 'start');
      await stage.execute();
      setStageTimestamp(run, stage.name, 'complete');
      saveCycleRun(db, run);
    } catch (err) {
      const failure = failCycleAtStage(stage.name, String(err));
      run.currentStage = 'failed';
      run.failedStage = failure.failedStage;
      run.failureReason = failure.reason;
      run.failedAt = new Date().toISOString();
      saveCycleRun(db, run);
      return run;
    }
  }

  // All stages completed
  run.currentStage = advanceCycleStage(run.currentStage, 'complete');
  run.completedAt = new Date().toISOString();
  saveCycleRun(db, run);

  return run;
}

function createInitialCycleRun(id: string, worldId: string, now: string): CycleRun {
  return {
    id,
    worldId,
    cycleNumber: 0, // Caller should set from DB sequence
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
    startedAt: now,
    completedAt: null,
    failedAt: null,
    failedStage: null,
    failureReason: null,
    observationBatchId: null,
    proposalIds: [],
    judgmentReportIds: [],
    appliedChangeIds: [],
    pulseFrameId: null,
    created_at: now,
    version: 1,
  };
}

function setStageTimestamp(
  run: CycleRun,
  stage: CycleStage,
  phase: 'start' | 'complete',
): void {
  const key = `${stage}${phase === 'start' ? 'Started' : 'Completed'}At` as keyof CycleRun;
  (run as Record<string, unknown>)[key] = new Date().toISOString();
}

function saveCycleRun(db: Database, run: CycleRun): void {
  db.run(
    `INSERT OR REPLACE INTO cycle_runs (id, world_id, cycle_number, current_stage, started_at, completed_at, failed_at, failed_stage, failure_reason, created_at, version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [run.id, run.worldId, run.cycleNumber, run.currentStage, run.startedAt, run.completedAt, run.failedAt, run.failedStage, run.failureReason, run.created_at, run.version]
  );
}
```

**Acceptance criteria**:
- [ ] `orchestrateCycle()` calls all 8 stage handlers in order
- [ ] Each stage records start/complete timestamps in CycleRun
- [ ] If a stage fails, cycle marks as `failed` with `failedStage` and `failureReason`
- [ ] CycleRun is persisted to SQLite after each stage transition
- [ ] Stage handlers are injected (DI), not hardcoded
- [ ] All artifact IDs (observationBatchId, proposalIds, etc.) are recorded

```bash
bun run build   # zero errors
```

**Git commit**: `feat(canonical-cycle): add cycle orchestrator with 10-stage pipeline`

---

## Step 3: Cycle Cadence + Timer + Tests

**Files**:
- `src/canonical-cycle/cycle-cadence.ts`
- `src/canonical-cycle/cycle-runner.test.ts`

**Reference**: `canonical-cycle.md` §12 (MVP cadence: 15min), CONTRACT.md CYCLE-03

**Key changes**:

1. Create `src/canonical-cycle/cycle-cadence.ts`:
```ts
import { z } from 'zod';

export const CycleCadenceSchema = z.object({
  /** Minutes between cycle starts. Must be > 0 (CYCLE-03) */
  intervalMinutes: z.number().int().positive(),

  /** Morning summary schedule (cron-like) */
  summarySchedule: z.string().optional(),

  /** Minutes an outcome window stays open after apply */
  outcomeWindowMinutes: z.number().int().positive().default(60),
});
export type CycleCadence = z.infer<typeof CycleCadenceSchema>;

/** Default cadence: every 15 minutes, 60-minute outcome windows */
export const DEFAULT_CADENCE: CycleCadence = {
  intervalMinutes: 15,
  summarySchedule: '0 6 * * *', // 6am daily
  outcomeWindowMinutes: 60,
};

/**
 * Validate cadence config. Rejects intervalMinutes <= 0 (CYCLE-03: never skippable).
 */
export function validateCadence(cadence: unknown): CycleCadence {
  const result = CycleCadenceSchema.safeParse(cadence);
  if (!result.success) {
    throw new Error(`Invalid cadence config: ${result.error.message}`);
  }
  return result.data;
}

/**
 * Calculate when the next cycle should start.
 */
export function getNextCycleTime(
  lastCycleStartedAt: string,
  cadence: CycleCadence,
): Date {
  const last = new Date(lastCycleStartedAt);
  return new Date(last.getTime() + cadence.intervalMinutes * 60_000);
}

/**
 * Create a timer that triggers cycle execution at the configured cadence.
 * Returns a cleanup function to stop the timer.
 */
export function startCycleTimer(
  cadence: CycleCadence,
  onTick: () => Promise<void>,
): { stop: () => void } {
  const intervalMs = cadence.intervalMinutes * 60_000;
  const handle = setInterval(() => {
    void onTick().catch(console.error);
  }, intervalMs);

  return {
    stop: () => clearInterval(handle),
  };
}
```

2. Test file `src/canonical-cycle/cycle-runner.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'bun:sqlite';
import { advanceCycleStage, failCycleAtStage, getNextStage, getStageOrder } from './cycle-state-machine';
import { CycleRunSchema } from '../schemas/cycle-run';
import { validateCadence, getNextCycleTime, DEFAULT_CADENCE } from './cycle-cadence';
import { orchestrateCycle } from './cycle-runner';

describe('CycleStateMachine', () => {
  it('enforces fixed stage order (CYCLE-01)', () => {
    const stages = getStageOrder();
    let current = stages[0]; // 'idle'
    for (let i = 1; i < stages.length; i++) {
      current = advanceCycleStage(current, stages[i]);
      expect(current).toBe(stages[i]);
    }
  });

  it('rejects skipping stages', () => {
    expect(() => advanceCycleStage('idle', 'judge')).toThrow();
    expect(() => advanceCycleStage('observe', 'apply')).toThrow();
    expect(() => advanceCycleStage('pulse', 'complete')).toThrow();
  });

  it('rejects advancing from failed', () => {
    expect(() => advanceCycleStage('failed', 'observe')).toThrow();
  });

  it('rejects advancing from complete', () => {
    expect(() => advanceCycleStage('complete', 'observe')).toThrow();
  });

  it('getNextStage returns correct successor', () => {
    expect(getNextStage('idle')).toBe('observe');
    expect(getNextStage('adjust')).toBe('complete');
    expect(getNextStage('complete')).toBeNull();
    expect(getNextStage('failed')).toBeNull();
  });

  it('failCycleAtStage produces structured failure', () => {
    const result = failCycleAtStage('judge', 'invariant violation');
    expect(result.stage).toBe('failed');
    expect(result.failedStage).toBe('judge');
    expect(result.reason).toBe('invariant violation');
  });
});

describe('CycleCadence', () => {
  it('validates default cadence', () => {
    expect(validateCadence(DEFAULT_CADENCE)).toEqual(DEFAULT_CADENCE);
  });

  it('rejects intervalMinutes = 0 (CYCLE-03)', () => {
    expect(() => validateCadence({ intervalMinutes: 0 })).toThrow();
  });

  it('rejects negative intervalMinutes', () => {
    expect(() => validateCadence({ intervalMinutes: -5 })).toThrow();
  });

  it('calculates next cycle time correctly', () => {
    const start = '2026-03-18T20:00:00Z';
    const next = getNextCycleTime(start, DEFAULT_CADENCE);
    expect(next.toISOString()).toBe('2026-03-18T20:15:00.000Z');
  });
});

describe('CycleRunner orchestration', () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(':memory:');
    // Init cycle_runs table
    db.run(`CREATE TABLE cycle_runs (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL,
      cycle_number INTEGER NOT NULL,
      current_stage TEXT NOT NULL DEFAULT 'idle',
      started_at TEXT NOT NULL,
      completed_at TEXT,
      failed_at TEXT,
      failed_stage TEXT,
      failure_reason TEXT,
      created_at TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1
    )`);
  });

  it('completes full cycle with all stages', async () => {
    const noopHandlers = {
      observe: async () => ({ id: 'ob1', worldId: 'w1', observations: [], createdAt: '', version: 1 }),
      propose: async () => [],
      judge: async () => [],
      apply: async () => [],
      pulse: async () => ({ pulseFrameId: 'pf1' }),
      outcome: async () => ({ outcomeReportIds: [] }),
      precedent: async () => ({ precedentIds: [] }),
      adjust: async () => ({ adjustmentIds: [] }),
    };

    const run = await orchestrateCycle(db, 'w1', {} as any, noopHandlers);
    expect(run.currentStage).toBe('complete');
    expect(run.completedAt).toBeTruthy();
    expect(run.failedAt).toBeNull();
  });

  it('marks cycle as failed when a stage throws', async () => {
    const failingHandlers = {
      observe: async () => ({ id: 'ob1', worldId: 'w1', observations: [], createdAt: '', version: 1 }),
      propose: async () => { throw new Error('chief unavailable'); },
      judge: async () => [],
      apply: async () => [],
      pulse: async () => ({ pulseFrameId: 'pf1' }),
      outcome: async () => ({ outcomeReportIds: [] }),
      precedent: async () => ({ precedentIds: [] }),
      adjust: async () => ({ adjustmentIds: [] }),
    };

    const run = await orchestrateCycle(db, 'w1', {} as any, failingHandlers);
    expect(run.currentStage).toBe('failed');
    expect(run.failedStage).toBe('propose');
    expect(run.failureReason).toContain('chief unavailable');
  });

  it('CycleRun schema validates completed run', async () => {
    // Validate that a completed CycleRun passes Zod
    const noopHandlers = { /* ... same as above */ };
    const run = await orchestrateCycle(db, 'w1', {} as any, noopHandlers);
    expect(CycleRunSchema.safeParse(run).success).toBe(true);
  });
});
```

**Acceptance criteria**:
- [ ] Full cycle completes: idle → observe → propose → judge → apply → pulse → outcome → precedent → adjust → complete
- [ ] Stage ordering enforced — skipping any stage throws (CYCLE-01)
- [ ] CycleRun artifact has all stage timestamps (CYCLE-02)
- [ ] Cadence validated — `intervalMinutes: 0` rejected (CYCLE-03)
- [ ] Default cadence = 15 minutes
- [ ] Failed cycle records `failedStage` and `failureReason`
- [ ] Tests use `:memory:` SQLite
- [ ] Timer cleanup function works (no leaked intervals)

```bash
bun run build                                         # zero errors
bun test src/canonical-cycle/cycle-runner.test.ts      # all pass
```

**Git commit**: `feat(canonical-cycle): add cycle cadence, timer, and orchestration tests`

---

## Track Completion Checklist

- [ ] Step 1: CycleRun Zod schema + state machine
- [ ] Step 2: Cycle orchestrator (10 stages)
- [ ] Step 3: Cycle cadence + timer + tests
- [ ] `bun run build` zero errors
- [ ] `bun test` — all cycle tests pass
- [ ] CycleRun tracks all 10 stage timestamps (CYCLE-02)
- [ ] Stages execute in fixed order (CYCLE-01)
- [ ] Cadence configurable, default 15min (CYCLE-03)
- [ ] Cycle produces structured CycleRun artifact
- [ ] Failed cycles record stage + reason
- [ ] No existing modules import from `canonical-cycle/`
