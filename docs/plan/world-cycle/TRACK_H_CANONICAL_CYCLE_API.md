# Track H: Canonical Cycle API Routes

> Batch 5（依賴所有其他 Tracks A-G）
> Repo: `C:\ai_agent\thyra`
> Parent: `docs/plan/world-cycle/TRACKS.md` — Track H
> Spec: `docs/world-design-v0/world-cycle-api.md` §8-18

## 核心設計

Build the complete REST API that maps every canonical cycle stage to an endpoint. All routes match `world-cycle-api.md` paths exactly (CONTRACT API-02) and use THY-11 envelope (CONTRACT API-01). This is the leaf track — it wires all modules (A-G) into a single API surface.

Depends on all other tracks: A (observation), B (proposals/judgment), C (cycle-runner), D (pulse), E (outcome), F (precedent), G (adjustment).

---

## Step 1: Cycle Management Routes

**Files**:
- `src/routes/cycles.ts`

**Reference**: `docs/world-design-v0/world-cycle-api.md` §9 (Cycle APIs)

**Key changes**:

1. Create `src/routes/cycles.ts`:
```ts
import { Hono } from 'hono';
import type { CycleRunner } from '../canonical-cycle/cycle-runner';

const app = new Hono();

// §9.1 — Open Cycle
// POST /api/v1/worlds/:id/cycles
app.post('/api/v1/worlds/:id/cycles', async (c) => {
  const worldId = c.req.param('id');
  const body = await c.req.json();
  // Validate: mode (normal/peak/incident/shutdown), openedBy
  // const cycle = cycleRunner.openCycle(worldId, body.mode, body.openedBy);
  // return c.json({ ok: true, data: cycle }, 201);
});

// §9.5 — List Cycles
// GET /api/v1/worlds/:id/cycles
app.get('/api/v1/worlds/:id/cycles', async (c) => {
  const worldId = c.req.param('id');
  const status = c.req.query('status');   // open | closed
  const mode = c.req.query('mode');       // normal | peak | incident | shutdown
  const limit = c.req.query('limit');
  // const cycles = cycleRunner.listByWorld(worldId, { status, mode, limit });
  // return c.json({ ok: true, data: cycles });
});

// §9.2 — Get Active Cycle
// GET /api/v1/worlds/:id/cycles/active
app.get('/api/v1/worlds/:id/cycles/active', async (c) => {
  const worldId = c.req.param('id');
  // const cycle = cycleRunner.getActive(worldId);
  // if (!cycle) return c.json({ ok: false, error: { code: 'NO_ACTIVE_CYCLE', message: 'No active cycle' } }, 404);
  // return c.json({ ok: true, data: cycle });
});

// §9.3 — Get Cycle by ID
// GET /api/v1/cycles/:id
app.get('/api/v1/cycles/:id', async (c) => {
  const cycleId = c.req.param('id');
  // const cycle = cycleRunner.get(cycleId);
  // if (!cycle) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Cycle not found' } }, 404);
  // return c.json({ ok: true, data: cycle });
});

// §9.4 — Close Cycle
// POST /api/v1/cycles/:id/close
app.post('/api/v1/cycles/:id/close', async (c) => {
  const cycleId = c.req.param('id');
  // freeze observation batch, freeze proposal list, emit cycle summary
  // const closed = cycleRunner.closeCycle(cycleId);
  // return c.json({ ok: true, data: closed });
});

export { app as cycleRoutes };
```

**Route summary**:

| Method | Path | API Spec | Description |
|--------|------|----------|-------------|
| POST | `/api/v1/worlds/:id/cycles` | §9.1 | Start new cycle |
| GET | `/api/v1/worlds/:id/cycles` | §9.5 | List cycles |
| GET | `/api/v1/worlds/:id/cycles/active` | §9.2 | Get active cycle |
| GET | `/api/v1/cycles/:id` | §9.3 | Get cycle details |
| POST | `/api/v1/cycles/:id/close` | §9.4 | Close cycle |

**Acceptance criteria**:
```bash
bun run build 2>&1 | grep -c "error" # expect 0
```

**Git commit**: `feat(api): add cycle management routes matching world-cycle-api §9`

---

## Step 2: Observation + Proposal + Judgment Routes

**Files**:
- `src/routes/observations.ts`
- `src/routes/proposals.ts` (extend or create)
- `src/routes/judgments.ts` (extend or create)
- `src/routes/applied-changes.ts`

**Reference**: `docs/world-design-v0/world-cycle-api.md` §10-13

**Key changes**:

1. Create `src/routes/observations.ts`:
```ts
import { Hono } from 'hono';

const app = new Hono();

// §10.2 — Get Observation Batch
// GET /api/v1/cycles/:id/observations
app.get('/api/v1/cycles/:id/observations', async (c) => {
  const cycleId = c.req.param('id');
  // const batch = observationBuilder.getBatch(cycleId);
  // return c.json({ ok: true, data: batch });
});

// §10.1 — Create Observation Batch
// POST /api/v1/cycles/:id/observations
app.post('/api/v1/cycles/:id/observations', async (c) => {
  const cycleId = c.req.param('id');
  const body = await c.req.json();
  // return c.json({ ok: true, data: batch }, 201);
});

export { app as observationRoutes };
```

2. Proposal + Judgment + Apply + Rollback routes:
```ts
// §11.1 — Create Proposal
// POST /api/v1/cycles/:id/proposals
app.post('/api/v1/cycles/:id/proposals', async (c) => {
  // Body uses ChangeProposal schema
  // return c.json({ ok: true, data: { proposalId, status: 'proposed' } }, 201);
});

// §11.2 — List Proposals
// GET /api/v1/cycles/:id/proposals
app.get('/api/v1/cycles/:id/proposals', async (c) => {
  // Query: status, chiefId, kind
  // return c.json({ ok: true, data: proposals });
});

// §11.3 — Get Proposal
// GET /api/v1/proposals/:id
app.get('/api/v1/proposals/:id', async (c) => { /* ... */ });

// §12.1 — Judge Proposal
// POST /api/v1/proposals/:id/judgment
app.post('/api/v1/proposals/:id/judgment', async (c) => {
  // Run 4-layer judgment stack (JUDGE-01)
  // return c.json({ ok: true, data: judgmentReport });
});

// §12.2 — Get Judgment Report
// GET /api/v1/proposals/:id/judgment
app.get('/api/v1/proposals/:id/judgment', async (c) => { /* ... */ });

// §13.1 — Apply Proposal
// POST /api/v1/proposals/:id/apply
app.post('/api/v1/proposals/:id/apply', async (c) => {
  // Requires Idempotency-Key header (§20)
  // Apply change, open outcome window, emit pulse
  // return c.json({ ok: true, data: { appliedChangeId, snapshotBeforeId, snapshotAfterId, openedOutcomeWindowId } });
});

// §13.3 — Rollback Applied Change
// POST /api/v1/applied-changes/:id/rollback
app.post('/api/v1/applied-changes/:id/rollback', async (c) => {
  // Requires Idempotency-Key header (§20)
  // return c.json({ ok: true, data: { rollbackId, status: 'completed', restoredSnapshotId } });
});
```

**Route summary**:

| Method | Path | API Spec | Description |
|--------|------|----------|-------------|
| GET | `/api/v1/cycles/:id/observations` | §10.2 | Get observation batch |
| POST | `/api/v1/cycles/:id/observations` | §10.1 | Create observation batch |
| POST | `/api/v1/cycles/:id/proposals` | §11.1 | Submit proposal |
| GET | `/api/v1/cycles/:id/proposals` | §11.2 | List proposals |
| GET | `/api/v1/proposals/:id` | §11.3 | Get proposal |
| POST | `/api/v1/proposals/:id/judgment` | §12.1 | Run judgment |
| GET | `/api/v1/proposals/:id/judgment` | §12.2 | Get judgment report |
| POST | `/api/v1/proposals/:id/apply` | §13.1 | Apply change |
| POST | `/api/v1/applied-changes/:id/rollback` | §13.3 | Rollback change |

**Acceptance criteria**:
```bash
bun run build 2>&1 | grep -c "error" # expect 0
```

**Git commit**: `feat(api): add observation, proposal, judgment, and apply/rollback routes`

---

## Step 3: Outcome + Precedent + Adjustment Routes + Integration Tests

**Files**:
- `src/routes/outcomes.ts`
- `src/routes/precedents.ts`
- `src/routes/pulse.ts`
- `src/routes/adjustments.ts` (from Track G, wire here)
- `src/canonical-cycle/canonical-cycle-api.test.ts`

**Reference**: `docs/world-design-v0/world-cycle-api.md` §14-17, VALIDATION.md GP-5

**Key changes**:

1. Create `src/routes/outcomes.ts`:
```ts
import { Hono } from 'hono';

const app = new Hono();

// §15.1 — Get Outcome Window
// GET /api/v1/outcome-windows/:id
app.get('/api/v1/outcome-windows/:id', async (c) => {
  // return c.json({ ok: true, data: window });
});

// §15.2 — Evaluate Outcome Window
// POST /api/v1/outcome-windows/:id/evaluate
app.post('/api/v1/outcome-windows/:id/evaluate', async (c) => {
  // Transition: open → evaluating → closed (OUTCOME-01)
  // Run outcome evaluator, build OutcomeReport
  // return c.json({ ok: true, data: { outcomeReportId, verdict, metricResults } });
});

// §15.3 — Get Outcome Report
// GET /api/v1/outcome-reports/:id
app.get('/api/v1/outcome-reports/:id', async (c) => {
  // return c.json({ ok: true, data: report });
});

// §15.4 — List Open Outcome Windows
// GET /api/v1/worlds/:id/outcome-windows
app.get('/api/v1/worlds/:id/outcome-windows', async (c) => {
  // Query: status=open|closed, proposalId
  // return c.json({ ok: true, data: windows });
});

export { app as outcomeRoutes };
```

2. Create `src/routes/precedents.ts`:
```ts
import { Hono } from 'hono';

const app = new Hono();

// §16.1 — List Precedents
// GET /api/v1/worlds/:id/precedents
app.get('/api/v1/worlds/:id/precedents', async (c) => {
  // Query: kind, targetPattern, verdict, contextTag
  // return c.json({ ok: true, data: precedents });
});

// §16.2 — Get Precedent
// GET /api/v1/precedents/:id
app.get('/api/v1/precedents/:id', async (c) => {
  // return c.json({ ok: true, data: precedent });
});

// §16.3 — Search Related Precedents
// POST /api/v1/precedents/search
app.post('/api/v1/precedents/search', async (c) => {
  // Body: worldType, proposalKind, contextTags
  // return c.json({ ok: true, data: results });
});

export { app as precedentRoutes };
```

3. Create `src/routes/pulse.ts`:
```ts
import { Hono } from 'hono';

const app = new Hono();

// §14.1 — Get Current Pulse
// GET /api/v1/worlds/:id/pulse
app.get('/api/v1/worlds/:id/pulse', async (c) => {
  // return c.json({ ok: true, data: pulseFrame });
});

// §14.2 — Pulse Stream (SSE) — deferred to UI track
// GET /api/v1/worlds/:id/pulse/stream

export { app as pulseRoutes };
```

4. Wire adjustment routes from Track G (`src/routes/adjustments.ts`):

| Method | Path | API Spec | Description |
|--------|------|----------|-------------|
| POST | `/api/v1/outcome-windows/:id/evaluate` | §15.2 | Evaluate outcome |
| GET | `/api/v1/outcome-windows/:id` | §15.1 | Get outcome window |
| GET | `/api/v1/outcome-reports/:id` | §15.3 | Get outcome report |
| GET | `/api/v1/worlds/:id/outcome-windows` | §15.4 | List outcome windows |
| GET | `/api/v1/worlds/:id/precedents` | §16.1 | List precedents |
| GET | `/api/v1/precedents/:id` | §16.2 | Get precedent |
| POST | `/api/v1/precedents/search` | §16.3 | Search precedents |
| GET | `/api/v1/worlds/:id/pulse` | §14.1 | Get latest pulse |
| POST | `/api/v1/worlds/:id/governance-adjustments` | §17.1 | Propose adjustment |
| GET | `/api/v1/worlds/:id/governance-adjustments` | §17.2 | List adjustments |

5. Integration test in `src/canonical-cycle/canonical-cycle-api.test.ts`:

**GP-5: Full 10-Stage Canonical Demo** (from VALIDATION.md):

```ts
import { describe, it, expect, beforeAll } from 'vitest';
// Setup: in-memory SQLite, Hono app with all routes mounted

describe('GP-5: Full Canonical Cycle via API', () => {
  // 1. POST /api/v1/worlds — create Midnight Market
  it('step 1: create world', async () => { /* ... */ });

  // 2. POST /api/v1/worlds/:id/cycles — start first cycle
  it('step 2: start cycle', async () => { /* ... */ });

  // 3. GET /api/v1/cycles/:id/observations — get observation batch
  it('step 3: get observations', async () => { /* ... */ });

  // 4. POST /api/v1/cycles/:id/proposals — chief proposes throttle_entry
  it('step 4: submit proposal', async () => { /* ... */ });

  // 5. POST /api/v1/proposals/:id/judgment — 4-layer judgment
  it('step 5: run judgment', async () => { /* ... */ });

  // 6. POST /api/v1/proposals/:id/apply — apply change
  it('step 6: apply change', async () => { /* ... */ });

  // 7. GET /api/v1/worlds/:id/pulse — see updated PulseFrame
  it('step 7: check pulse', async () => {
    // healthScore, mode, stability, dominantConcerns present (PULSE-01)
  });

  // 8. POST /api/v1/outcome-windows/:id/evaluate — evaluate outcome
  it('step 8: evaluate outcome', async () => {
    // OutcomeReport with verdict + metric deltas (OUTCOME-02)
  });

  // 9. GET /api/v1/worlds/:id/precedents — see PrecedentRecord
  it('step 9: check precedent', async () => {
    // proposalId + outcomeReportId linked (PREC-01)
  });

  // 10. POST /api/v1/worlds/:id/governance-adjustments — if verdict=harmful
  it('step 10: governance adjustment (conditional)', async () => {
    // Only fires if needed (ADJ-02)
  });
});

describe('API envelope compliance (API-01)', () => {
  it('all success responses have { ok: true, data }', async () => { /* ... */ });
  it('all error responses have { ok: false, error: { code, message } }', async () => { /* ... */ });
});

describe('route path compliance (API-02)', () => {
  it('all routes match world-cycle-api.md paths', async () => {
    // Enumerate registered routes and compare against spec
  });
});
```

**Acceptance criteria**:
```bash
bun run build 2>&1 | grep -c "error" # expect 0
bun test src/canonical-cycle/canonical-cycle-api.test.ts
```

**Git commit**: `feat(api): add outcome, precedent, pulse routes and GP-5 integration test`

---

## Complete Route Inventory

All routes exposed by Track H, mapped to `world-cycle-api.md`:

| # | Method | Path | Spec | Track Source |
|---|--------|------|------|-------------|
| 1 | POST | `/api/v1/worlds/:id/cycles` | §9.1 | C |
| 2 | GET | `/api/v1/worlds/:id/cycles` | §9.5 | C |
| 3 | GET | `/api/v1/worlds/:id/cycles/active` | §9.2 | C |
| 4 | GET | `/api/v1/cycles/:id` | §9.3 | C |
| 5 | POST | `/api/v1/cycles/:id/close` | §9.4 | C |
| 6 | GET | `/api/v1/cycles/:id/observations` | §10.2 | A |
| 7 | POST | `/api/v1/cycles/:id/observations` | §10.1 | A |
| 8 | POST | `/api/v1/cycles/:id/proposals` | §11.1 | B |
| 9 | GET | `/api/v1/cycles/:id/proposals` | §11.2 | B |
| 10 | GET | `/api/v1/proposals/:id` | §11.3 | B |
| 11 | POST | `/api/v1/proposals/:id/judgment` | §12.1 | B |
| 12 | GET | `/api/v1/proposals/:id/judgment` | §12.2 | B |
| 13 | POST | `/api/v1/proposals/:id/apply` | §13.1 | B |
| 14 | POST | `/api/v1/applied-changes/:id/rollback` | §13.3 | B |
| 15 | GET | `/api/v1/worlds/:id/pulse` | §14.1 | D |
| 16 | GET | `/api/v1/outcome-windows/:id` | §15.1 | E |
| 17 | POST | `/api/v1/outcome-windows/:id/evaluate` | §15.2 | E |
| 18 | GET | `/api/v1/outcome-reports/:id` | §15.3 | E |
| 19 | GET | `/api/v1/worlds/:id/outcome-windows` | §15.4 | E |
| 20 | GET | `/api/v1/worlds/:id/precedents` | §16.1 | F |
| 21 | GET | `/api/v1/precedents/:id` | §16.2 | F |
| 22 | POST | `/api/v1/precedents/search` | §16.3 | F |
| 23 | POST | `/api/v1/worlds/:id/governance-adjustments` | §17.1 | G |
| 24 | GET | `/api/v1/worlds/:id/governance-adjustments` | §17.2 | G |
| 25 | POST | `/api/v1/governance-adjustments/:id/apply` | §17.3 | G |

---

## Track Completion Checklist

- [ ] `bun run build` — zero TypeScript errors
- [ ] All 25 routes match world-cycle-api.md paths exactly (API-02)
- [ ] All routes use THY-11 envelope: `{ ok: true, data }` / `{ ok: false, error: { code, message } }` (API-01)
- [ ] All 10 canonical cycle stages have corresponding endpoints
- [ ] Cycle routes: open, list, get, get active, close
- [ ] Observation routes: create batch, get batch
- [ ] Proposal routes: create, list, get
- [ ] Judgment routes: judge, get report
- [ ] Apply/Rollback routes: apply with idempotency, rollback with idempotency
- [ ] Pulse route: get current pulse
- [ ] Outcome routes: get window, evaluate, get report, list windows
- [ ] Precedent routes: list, get, search
- [ ] Adjustment routes: create, list, apply
- [ ] GP-5 integration test: full 10-stage cycle via API passes
- [ ] Tests with `:memory:` SQLite
- [ ] No `any`, no `!` assertions (THY-01)
