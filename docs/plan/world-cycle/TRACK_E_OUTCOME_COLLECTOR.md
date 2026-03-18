# Track E: Outcome Collector

> Batch 3（依賴 Track C）
> Repo: `C:\ai_agent\thyra`
> Parent: `docs/plan/world-cycle/TRACKS.md` — Track E
> Spec: `docs/world-design-v0/pulse-and-outcome-metrics-v0.md` §14-27, `docs/world-design-v0/shared-types.md` §6.9

## 核心設計

Build outcome windows that track metric deltas after a change is applied, and produce OutcomeReports with verdicts (beneficial/neutral/harmful/inconclusive). An OutcomeWindow has an explicit lifecycle (open → evaluating → closed) — no auto-close (CONTRACT OUTCOME-01). OutcomeReports compare baseline vs observed metrics with delta (CONTRACT OUTCOME-02).

Depends on Track C's CycleRunner (cycle provides the apply → outcome transition).

---

## Step 1: OutcomeWindow Schema + Lifecycle

**Files**:
- `src/schemas/outcome-window.ts`
- `src/canonical-cycle/outcome-window.ts`

**Reference**: `docs/world-design-v0/world-cycle-api.md` §19 (Outcome Window state transitions), CONTRACT OUTCOME-01

**Key changes**:

1. Create `src/schemas/outcome-window.ts`:
```ts
import { z } from 'zod';

export const OutcomeWindowStatusSchema = z.enum(['open', 'evaluating', 'closed']);
export type OutcomeWindowStatus = z.infer<typeof OutcomeWindowStatusSchema>;

export const OutcomeWindowSchema = z.object({
  id: z.string(),
  worldId: z.string(),
  appliedChangeId: z.string(),
  proposalId: z.string(),
  cycleId: z.string(),
  status: OutcomeWindowStatusSchema,
  baselineSnapshot: z.record(z.string(), z.number()), // metric name → baseline value
  openedAt: z.string(),
  evaluatedAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  version: z.number().int().min(1),
});
export type OutcomeWindow = z.infer<typeof OutcomeWindowSchema>;

export const CreateOutcomeWindowInputSchema = z.object({
  worldId: z.string(),
  appliedChangeId: z.string(),
  proposalId: z.string(),
  cycleId: z.string(),
  baselineSnapshot: z.record(z.string(), z.number()),
});
export type CreateOutcomeWindowInput = z.infer<typeof CreateOutcomeWindowInputSchema>;
```

2. Create `src/canonical-cycle/outcome-window.ts`:
```ts
import type { Database } from 'bun:sqlite';
import type { CreateOutcomeWindowInput, OutcomeWindow, OutcomeWindowStatus } from '../schemas/outcome-window';
import { nanoid } from 'nanoid';
import { appendAudit } from '../db';

// Valid transitions: open → evaluating → closed (OUTCOME-01: no auto-close, no skip)
const VALID_TRANSITIONS: Record<OutcomeWindowStatus, OutcomeWindowStatus[]> = {
  open: ['evaluating'],
  evaluating: ['closed'],
  closed: [],
};

export class OutcomeWindowManager {
  constructor(private db: Database) {}

  create(input: CreateOutcomeWindowInput): OutcomeWindow { /* ... */ }
  get(id: string): OutcomeWindow | null { /* ... */ }
  listByWorld(worldId: string, status?: OutcomeWindowStatus): OutcomeWindow[] { /* ... */ }

  /** Transition status with validation — cannot skip from open to closed */
  transition(id: string, to: OutcomeWindowStatus): OutcomeWindow {
    const window = this.get(id);
    if (!window) throw new Error(`OutcomeWindow not found: ${id}`);
    if (!VALID_TRANSITIONS[window.status].includes(to)) {
      throw new Error(`Invalid transition: ${window.status} → ${to}`);
    }
    // Update status, set evaluatedAt/closedAt timestamps
    // appendAudit(this.db, 'outcome_window', id, 'transition', { from: window.status, to });
    return { ...window, status: to, version: window.version + 1 };
  }
}
```

3. DB table `outcome_windows`:
```sql
CREATE TABLE IF NOT EXISTS outcome_windows (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL,
  applied_change_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  cycle_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  baseline_snapshot TEXT NOT NULL, -- JSON
  opened_at TEXT NOT NULL,
  evaluated_at TEXT,
  closed_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**Acceptance criteria**:
```bash
bun run build 2>&1 | grep -c "error" # expect 0
bun test src/canonical-cycle/outcome-window.test.ts
```

**Git commit**: `feat(outcome): add OutcomeWindow schema and lifecycle state machine`

---

## Step 2: Outcome Evaluator (Metric Comparison)

**Files**:
- `src/canonical-cycle/outcome-evaluator.ts`

**Reference**: `docs/world-design-v0/pulse-and-outcome-metrics-v0.md` §20-22, `docs/world-design-v0/shared-types.md` §6.9 (ExpectedEffectResult, SideEffectResult)

**Key changes**:

1. Create `src/canonical-cycle/outcome-evaluator.ts`:
```ts
import type { ExpectedEffectResult, SideEffectResult } from '../schemas/outcome-report';

export interface ExpectedEffect {
  metric: string;
  expectedDirection: 'up' | 'down' | 'stable';
}

export interface EvaluationInput {
  baselineSnapshot: Record<string, number>;
  currentSnapshot: Record<string, number>;
  expectedEffects: ExpectedEffect[];
  sideEffectMetrics: string[]; // metrics to check for unintended changes
}

export interface EvaluationResult {
  primaryObjectiveMet: boolean;
  expectedEffects: ExpectedEffectResult[];
  sideEffects: SideEffectResult[];
}

/**
 * Compare baseline metrics vs current metrics after observation window.
 * - Compute delta per metric
 * - Check matched: did metric move in expectedDirection?
 * - Detect side effects on non-target metrics
 * - Classify side effect severity: negligible (<5%), minor (5-15%), significant (>15%)
 */
export function evaluateOutcome(input: EvaluationInput): EvaluationResult {
  const expectedResults: ExpectedEffectResult[] = input.expectedEffects.map(effect => {
    const baseline = input.baselineSnapshot[effect.metric] ?? 0;
    const observed = input.currentSnapshot[effect.metric] ?? 0;
    const delta = observed - baseline;
    const matched = matchesDirection(delta, effect.expectedDirection);
    return { metric: effect.metric, expectedDirection: effect.expectedDirection, baseline, observed, delta, matched };
  });

  const sideResults: SideEffectResult[] = input.sideEffectMetrics
    .filter(m => !input.expectedEffects.some(e => e.metric === m))
    .map(metric => {
      const baseline = input.baselineSnapshot[metric] ?? 0;
      const observed = input.currentSnapshot[metric] ?? 0;
      const delta = observed - baseline;
      const pctChange = baseline !== 0 ? Math.abs(delta / baseline) : 0;
      const severity = pctChange < 0.05 ? 'negligible' : pctChange < 0.15 ? 'minor' : 'significant';
      return { metric, baseline, observed, delta, severity, acceptable: severity !== 'significant' };
    });

  const primaryObjectiveMet = expectedResults.length > 0 && expectedResults.every(r => r.matched);

  return { primaryObjectiveMet, expectedEffects: expectedResults, sideEffects: sideResults };
}

function matchesDirection(delta: number, direction: 'up' | 'down' | 'stable'): boolean {
  switch (direction) {
    case 'up': return delta > 0;
    case 'down': return delta < 0;
    case 'stable': return Math.abs(delta) < 0.01; // negligible change
  }
}
```

**Acceptance criteria**:
```bash
bun run build 2>&1 | grep -c "error" # expect 0
bun test src/canonical-cycle/outcome-evaluator.test.ts
```

**Git commit**: `feat(outcome): add outcome evaluator with baseline vs observed comparison`

---

## Step 3: OutcomeReport Builder + Tests

**Files**:
- `src/schemas/outcome-report.ts`
- `src/canonical-cycle/outcome-report-builder.ts`
- `src/canonical-cycle/outcome-collector.test.ts`

**Reference**: `docs/world-design-v0/shared-types.md` §6.9, `docs/world-design-v0/pulse-and-outcome-metrics-v0.md` §15-24

**Key changes**:

1. Create `src/schemas/outcome-report.ts`:
```ts
import { z } from 'zod';

export const OutcomeVerdictSchema = z.enum(['beneficial', 'neutral', 'harmful', 'inconclusive']);
export type OutcomeVerdict = z.infer<typeof OutcomeVerdictSchema>;

export const OutcomeRecommendationSchema = z.enum(['reinforce', 'retune', 'watch', 'rollback', 'do_not_repeat']);
export type OutcomeRecommendation = z.infer<typeof OutcomeRecommendationSchema>;

export const ExpectedEffectResultSchema = z.object({
  metric: z.string(),
  expectedDirection: z.enum(['up', 'down', 'stable']),
  baseline: z.number(),
  observed: z.number(),
  delta: z.number(),
  matched: z.boolean(),
});
export type ExpectedEffectResult = z.infer<typeof ExpectedEffectResultSchema>;

export const SideEffectResultSchema = z.object({
  metric: z.string(),
  baseline: z.number(),
  observed: z.number(),
  delta: z.number(),
  severity: z.enum(['negligible', 'minor', 'significant']),
  acceptable: z.boolean(),
});
export type SideEffectResult = z.infer<typeof SideEffectResultSchema>;

export const OutcomeReportSchema = z.object({
  id: z.string(),
  appliedChangeId: z.string(),
  outcomeWindowId: z.string(),
  primaryObjectiveMet: z.boolean(),
  expectedEffects: z.array(ExpectedEffectResultSchema),
  sideEffects: z.array(SideEffectResultSchema),
  verdict: OutcomeVerdictSchema,
  recommendation: OutcomeRecommendationSchema,
  notes: z.array(z.string()),
  createdAt: z.string(),
});
export type OutcomeReport = z.infer<typeof OutcomeReportSchema>;
```

2. Create `src/canonical-cycle/outcome-report-builder.ts`:
```ts
import type { EvaluationResult } from './outcome-evaluator';
import type { OutcomeReport, OutcomeVerdict, OutcomeRecommendation } from '../schemas/outcome-report';
import { nanoid } from 'nanoid';

export interface BuildReportInput {
  appliedChangeId: string;
  outcomeWindowId: string;
  evaluation: EvaluationResult;
}

/**
 * Build OutcomeReport from evaluation results.
 *
 * Verdict rules (from pulse-and-outcome-metrics-v0.md §15-19):
 * - beneficial: primaryObjectiveMet && no significant side effects
 * - harmful: !primaryObjectiveMet || significant unacceptable side effects
 * - neutral: primaryObjectiveMet but marginal, or no clear signal
 * - inconclusive: mixed signals, can't determine
 *
 * Recommendation mapping (§24):
 * - beneficial → reinforce
 * - harmful + significant damage → rollback
 * - harmful + moderate → do_not_repeat
 * - neutral → watch
 * - inconclusive → watch
 * - partial match → retune
 */
export function buildOutcomeReport(input: BuildReportInput): OutcomeReport {
  const { evaluation } = input;
  const verdict = determineVerdict(evaluation);
  const recommendation = determineRecommendation(verdict, evaluation);
  const notes = generateNotes(evaluation, verdict);

  return {
    id: `or_${nanoid(12)}`,
    appliedChangeId: input.appliedChangeId,
    outcomeWindowId: input.outcomeWindowId,
    primaryObjectiveMet: evaluation.primaryObjectiveMet,
    expectedEffects: evaluation.expectedEffects,
    sideEffects: evaluation.sideEffects,
    verdict,
    recommendation,
    notes,
    createdAt: new Date().toISOString(),
  };
}

function determineVerdict(eval_: EvaluationResult): OutcomeVerdict { /* ... */ }
function determineRecommendation(verdict: OutcomeVerdict, eval_: EvaluationResult): OutcomeRecommendation { /* ... */ }
function generateNotes(eval_: EvaluationResult, verdict: OutcomeVerdict): string[] { /* ... */ }
```

3. Tests in `src/canonical-cycle/outcome-collector.test.ts`:

**Test cases**:

| Test | Description | Key assertion |
|------|------------|---------------|
| beneficial outcome | All expected effects matched, no significant side effects | verdict=beneficial, recommendation=reinforce |
| harmful outcome | Primary objective not met, metric degraded | verdict=harmful, recommendation=rollback or do_not_repeat |
| inconclusive outcome | Mixed signals, some matched some not | verdict=inconclusive, recommendation=watch |
| neutral outcome | Primary met but marginal deltas | verdict=neutral, recommendation=watch |
| side effects detected | Non-target metric changed significantly | sideEffects[].severity=significant, acceptable=false |
| OutcomeWindow lifecycle | open → evaluating → closed, skip rejected | transition('open','closed') throws |
| baseline snapshot preserved | Report references correct baseline | expectedEffects[].baseline matches window baseline |

**Acceptance criteria**:
```bash
bun run build 2>&1 | grep -c "error" # expect 0
bun test src/canonical-cycle/outcome-collector.test.ts
```

**Git commit**: `feat(outcome): add OutcomeReport builder with verdict and recommendation engine`

---

## Track Completion Checklist

- [ ] `bun run build` — zero TypeScript errors
- [ ] OutcomeWindow has explicit open/close lifecycle (OUTCOME-01)
- [ ] OutcomeReport compares baseline vs observed with delta (OUTCOME-02)
- [ ] OutcomeVerdict: beneficial / neutral / harmful / inconclusive
- [ ] OutcomeRecommendation: reinforce / retune / watch / rollback / do_not_repeat
- [ ] SideEffectResult.severity: negligible / minor / significant
- [ ] All entities have `id`, `created_at`, `version` (THY-04)
- [ ] All state changes write audit_log (THY-07)
- [ ] Tests: beneficial, harmful, inconclusive, neutral, side effects, lifecycle enforcement
- [ ] No `any`, no `!` assertions (THY-01)
