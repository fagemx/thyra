# Track A: Observation Builder

> Batch 1（無前置依賴，blocks B/C/D）
> Repo: `C:\ai_agent\thyra`
> Layer: L0 觀察層
> Spec: `docs/world-design-v0/canonical-cycle.md` §4.1, `docs/plan/world-cycle/TRACKS.md` Track A

## 核心設計

Build structured observation batches from world state diffs, audit log events, and external signals. Observations are the raw input that drives each governance cycle — they answer "what happened since last cycle?" without making judgments.

New modules live in `src/canonical-cycle/`. They import from existing `src/world/` but existing modules never import from `canonical-cycle/`.

---

## Step 1: ObservationBatch Zod Schema + Builder

**Files**:
- `src/schemas/observation.ts`
- `src/canonical-cycle/observation-builder.ts`

**Reference**: `canonical-cycle.md` §4.1, `shared-types.md` §6.7 (Concern)

**Key changes**:

1. Create `src/schemas/observation.ts`:
```ts
import { z } from 'zod';

export const ObservationSourceSchema = z.enum([
  'state_diff',
  'audit_log',
  'external',
  'chief_inspection',
  'outcome_followup',
]);
export type ObservationSource = z.infer<typeof ObservationSourceSchema>;

export const ObservationSchema = z.object({
  id: z.string(),
  source: ObservationSourceSchema,
  timestamp: z.string(),
  scope: z.enum(['world', 'zone', 'stall', 'event', 'entry_gate', 'law', 'chief']),
  importance: z.enum(['low', 'medium', 'high', 'critical']),
  summary: z.string(),
  details: z.record(z.unknown()).optional(),
  targetIds: z.array(z.string()).optional(),
});
export type Observation = z.infer<typeof ObservationSchema>;

export const ObservationBatchSchema = z.object({
  id: z.string(),
  worldId: z.string(),
  cycleId: z.string().optional(),
  observations: z.array(ObservationSchema),
  createdAt: z.string(),
  version: z.number().default(1),
});
export type ObservationBatch = z.infer<typeof ObservationBatchSchema>;
```

2. Create `src/canonical-cycle/observation-builder.ts`:
```ts
import type { Database } from 'bun:sqlite';
import type { WorldState } from '../world/state';
import type { WorldStateDiff } from '../world/diff';
import type { Observation, ObservationBatch } from '../schemas/observation';
import { diffWorldState } from '../world/diff';

export interface ObservationBuilderDeps {
  db: Database;
  worldId: string;
  previousState: WorldState | null;
  currentState: WorldState;
  externalEvents?: ExternalEvent[];
}

export interface ExternalEvent {
  id: string;
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
}

/** Build an ObservationBatch from all available sources */
export function buildObservationBatch(deps: ObservationBuilderDeps): ObservationBatch {
  const observations: Observation[] = [];

  // Source 1: state diff
  if (deps.previousState) {
    const diffObs = observeFromStateDiff(deps.previousState, deps.currentState);
    observations.push(...diffObs);
  }

  // Source 2: audit log
  const auditObs = observeFromAuditLog(deps.db, deps.worldId);
  observations.push(...auditObs);

  // Source 3: external events
  if (deps.externalEvents) {
    const extObs = observeFromExternal(deps.externalEvents);
    observations.push(...extObs);
  }

  return {
    id: `obs_batch_${Date.now()}`,
    worldId: deps.worldId,
    observations,
    createdAt: new Date().toISOString(),
    version: 1,
  };
}
```

**Acceptance criteria**:
- [ ] `ObservationBatchSchema.safeParse(batch)` succeeds for valid batches
- [ ] `ObservationSchema` requires `id`, `source`, `timestamp`, `scope`, `importance`, `summary`
- [ ] `ObservationSource` has exactly 5 values
- [ ] Builder function signature is pure (deps in, batch out)
- [ ] No imports from `canonical-cycle/` in existing `world/` modules

```bash
bun run build   # zero errors
```

**Git commit**: `feat(canonical-cycle): add ObservationBatch schema and builder scaffold`

---

## Step 2: Observation Source Adapters + Tests

**Files**:
- `src/canonical-cycle/observation-sources/state-diff-source.ts`
- `src/canonical-cycle/observation-sources/audit-log-source.ts`
- `src/canonical-cycle/observation-sources/external-source.ts`
- `src/canonical-cycle/observation-builder.test.ts`

**Reference**: `canonical-cycle.md` §4.1 (5 observation sources)

**Key changes**:

1. Create `src/canonical-cycle/observation-sources/state-diff-source.ts`:
```ts
import type { WorldState } from '../../world/state';
import type { Observation } from '../../schemas/observation';
import { diffWorldState } from '../../world/diff';

/**
 * Derive observations from state diff between two snapshots.
 * Each significant change becomes a structured Observation.
 */
export function observeFromStateDiff(
  previous: WorldState,
  current: WorldState,
): Observation[] {
  const diff = diffWorldState(previous, current);
  const observations: Observation[] = [];

  // chiefs added/removed → high importance
  if (diff.chiefs.added.length > 0 || diff.chiefs.removed.length > 0) {
    observations.push({
      id: `obs_diff_chief_${Date.now()}`,
      source: 'state_diff',
      timestamp: new Date().toISOString(),
      scope: 'chief',
      importance: 'high',
      summary: `Chief changes: +${diff.chiefs.added.length} -${diff.chiefs.removed.length}`,
      targetIds: [
        ...diff.chiefs.added.map(c => c.id),
        ...diff.chiefs.removed.map(c => c.id),
      ],
    });
  }

  // laws changed → medium importance
  if (diff.laws.added.length > 0 || diff.laws.removed.length > 0) {
    observations.push({
      id: `obs_diff_law_${Date.now()}`,
      source: 'state_diff',
      timestamp: new Date().toISOString(),
      scope: 'law',
      importance: 'medium',
      summary: `Law changes: +${diff.laws.added.length} -${diff.laws.removed.length}`,
    });
  }

  return observations;
}
```

2. Create `src/canonical-cycle/observation-sources/audit-log-source.ts`:
```ts
import type { Database } from 'bun:sqlite';
import type { Observation } from '../../schemas/observation';

/**
 * Read recent audit_log entries and convert to Observations.
 * Filters by village_id and since last cycle timestamp.
 */
export function observeFromAuditLog(
  db: Database,
  worldId: string,
  sinceTimestamp?: string,
): Observation[] {
  const since = sinceTimestamp ?? new Date(Date.now() - 15 * 60_000).toISOString();
  const rows = db.query(
    `SELECT * FROM audit_log WHERE village_id = ? AND created_at > ? ORDER BY created_at ASC`
  ).all(worldId, since) as Array<{
    id: string; action: string; created_at: string; details: string;
  }>;

  return rows.map(row => ({
    id: `obs_audit_${row.id}`,
    source: 'audit_log' as const,
    timestamp: row.created_at,
    scope: 'world' as const,
    importance: 'medium' as const,
    summary: `Audit: ${row.action}`,
    details: row.details ? JSON.parse(row.details) as Record<string, unknown> : undefined,
  }));
}
```

3. Create `src/canonical-cycle/observation-sources/external-source.ts`:
```ts
import type { Observation } from '../../schemas/observation';
import type { ExternalEvent } from '../observation-builder';

/**
 * Convert external events (Karvi webhooks, human actions, timers) to Observations.
 */
export function observeFromExternal(events: ExternalEvent[]): Observation[] {
  return events.map(event => ({
    id: `obs_ext_${event.id}`,
    source: 'external' as const,
    timestamp: event.timestamp,
    scope: 'world' as const,
    importance: 'medium' as const,
    summary: `External: ${event.type}`,
    details: event.data,
  }));
}
```

4. Test file `src/canonical-cycle/observation-builder.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'bun:sqlite';
import { buildObservationBatch } from './observation-builder';
import { ObservationBatchSchema } from '../schemas/observation';

describe('ObservationBuilder', () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(':memory:');
    // initSchema(db) — set up audit_log table etc.
  });

  it('builds batch from state diff', () => { /* ... */ });
  it('builds batch from audit log', () => { /* ... */ });
  it('builds batch from external events', () => { /* ... */ });
  it('batch passes Zod validation', () => {
    const batch = buildObservationBatch({ db, worldId: 'w1', previousState: null, currentState: /* ... */ });
    expect(ObservationBatchSchema.safeParse(batch).success).toBe(true);
  });
  it('empty sources produce empty observations array', () => { /* ... */ });
});
```

**Acceptance criteria**:
- [ ] Each source adapter is a pure function (no side effects beyond DB read)
- [ ] state-diff source detects chief/law/skill changes from WorldStateDiff
- [ ] audit-log source queries by village_id + time window
- [ ] external source maps ExternalEvent[] to Observation[]
- [ ] All observations pass `ObservationSchema.safeParse()`
- [ ] Tests use `:memory:` SQLite
- [ ] No `any` types, no `!` assertions

```bash
bun run build                                           # zero errors
bun test src/canonical-cycle/observation-builder.test.ts # all pass
```

**Git commit**: `feat(canonical-cycle): add observation source adapters and tests`

---

## Track Completion Checklist

- [ ] Step 1: ObservationBatch Zod schema + builder function
- [ ] Step 2: Observation source adapters + tests
- [ ] `bun run build` zero errors
- [ ] `bun test` — all observation tests pass
- [ ] ObservationBatch schema includes: source, timestamp, scope, importance, observations array
- [ ] Builder aggregates from state diffs + audit log + external events
- [ ] No existing `world/` module imports from `canonical-cycle/`
