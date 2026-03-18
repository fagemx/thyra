# Decision State Storage — Validation Plan

## Track Acceptance Criteria

### Track A: Völva Working State DB

| Item | Pass Criteria | Verification |
|------|--------------|-------------|
| Build | `bun run build` zero errors | `cd volva && bun run build 2>&1` |
| Schema init | All 8 tables created | `initStorageSchema()` then query `sqlite_master` |
| Session CRUD | Create/read/update/list sessions | `bun test src/storage/session-store.test.ts` |
| Candidate CRUD | Full lifecycle: generated → pruned → committed | `bun test src/storage/candidate-store.test.ts` |
| Probe CRUD | Full lifecycle: draft → running → completed | `bun test src/storage/probe-store.test.ts` |
| Event log | Append-only, no UPDATE/DELETE | `bun test src/storage/event-log.test.ts` |
| ID prefixes | All IDs use correct prefix | `grep -rn "generateId" src/storage/` |
| API format | All routes return `{ ok, data/error }` | Route tests |

### Track B: Cross-Layer ID Infrastructure

| Item | Pass Criteria | Verification |
|------|--------------|-------------|
| Build | `bun run build` zero errors | `bun run build 2>&1` |
| SourceRef type | Validates all 6 layers + kind + id | `bun test src/cross-layer/source-ref.test.ts` |
| ID generation | Produces `<prefix>_<random>` format | `bun test src/cross-layer/` |
| Invalid rejection | Bad prefixes / layers rejected | Schema validation tests |

### Track C: Promotion Engine

| Item | Pass Criteria | Verification |
|------|--------------|-------------|
| Build | `bun run build` zero errors | `bun run build 2>&1` |
| Handoff schema | Both payloads validate | `bun test src/promotion/` |
| Checklist evaluator | Per-target criteria | `bun test src/promotion/checklist-evaluator.test.ts` |
| Package output | Produces valid `handoff.json` + `checklist.json` | `bun test src/promotion/handoff-packager.test.ts` |
| Empty stableObjects rejected | PROMO-01 enforced | Schema validation test |

### Track D: Edda Ingestion Engine

| Item | Pass Criteria | Verification |
|------|--------------|-------------|
| Build | `bun run build` zero errors | `cd edda && bun run build 2>&1` |
| Auto triggers | 8 auto triggers fire correctly | `bun test src/ingestion/trigger-evaluator.test.ts` |
| Suggest triggers | 6 suggest triggers queue correctly | Same test file |
| Never events dropped | 8 never events silently skipped | Same test file |
| Suggestion workflow | accept → record, reject → discard | `bun test src/ingestion/suggestion-queue.test.ts` |
| SourceRefs populated | Every record has traceability | Ingestion writer tests |

### Track E: Promotion Rollback

| Item | Pass Criteria | Verification |
|------|--------------|-------------|
| Build | `bun run build` zero errors | `bun run build 2>&1` |
| Rollback memo | References original handoff | `bun test src/promotion/rollback-engine.test.ts` |
| Suspended state | downstream = suspended, not deleted | Same test file |
| Edda auto-ingest | Rollback triggers precedent record | Integration test |
| Both rollback types | Type A + Type B tested | Same test file |

---

## Golden Path Scenarios

### GP-1: Minimum Decision Persistence Loop (Track A)

**Description**: Create a decision session, generate candidates, run a probe, record a commit memo — all persisted to Völva DB.

**Steps**:
1. `POST /api/storage/sessions` → create session (ds_xxx)
2. `POST /api/storage/candidates` → generate candidate (cand_xxx)
3. `POST /api/storage/probes` → create probe (probe_xxx)
4. `PATCH /api/storage/probes/:id` → complete probe
5. `POST /api/storage/signals` → record signal (sig_xxx)
6. `POST /api/storage/commit-memos` → create commit memo (commit_xxx)
7. `GET /api/storage/events` → verify all transitions recorded as events

**Verification**: 7 records across 6 tables, all IDs with correct prefixes, event log has 6+ entries.

---

### GP-2: Cross-Layer Promotion (Track A + B + C)

**Description**: From working state to promotion handoff — a decision session produces a commit memo, triggers a promotion check, packages a handoff.

**Steps**:
1. Complete GP-1 (working state populated)
2. `POST /api/promotion/checklists` → evaluate promotion readiness
3. Checklist verdict = "ready"
4. `POST /api/promotion/handoffs` → package handoff with sourceRefs
5. Verify `handoff.json` contains `stableObjects` pointing to session + commit memo
6. Verify `sourceLinks` trace back to `ds_xxx` session

**Verification**: Handoff JSON has valid `PromotionHandoff` schema, `sourceRefs` are populated, checklist is attached.

---

### GP-3: Edda Ingestion Closed Loop (Track A + B + D)

**Description**: A decision event triggers auto-ingest into Edda.

**Steps**:
1. Complete GP-1 (commit memo created)
2. `commit_drafted` event fires
3. Ingestion evaluator classifies as `auto`
4. `EddaIngestionRecord` written with `sourceRefs` → `[{layer: "L1", kind: "commit-memo", id: "commit_xxx"}]`
5. `GET /api/ingestion/records` → verify record exists with correct tags

**Verification**: Edda has a precedent record with traceability back to L1 commit memo.

---

### GP-4: Promotion Rollback (Track A + B + C + E)

**Description**: A promotion is rolled back after discovering the concept wasn't stable.

**Steps**:
1. Complete GP-2 (handoff created)
2. `POST /api/promotion/rollbacks` → create rollback memo
3. Verify `originalHandoffId` points to GP-2's handoff
4. Verify downstream marked `suspended`
5. Verify Edda auto-ingest triggered (`decision.rollback` event)
6. Verify `specsNeedingReview` list is populated

**Verification**: Rollback memo valid, downstream suspended (not deleted), Edda has rollback precedent, ID chain unbroken.

---

## Quality Benchmarks

| CONTRACT Rule | Metric | Baseline | Verification |
|--------------|--------|----------|-------------|
| STORE-01 | Event log is append-only | No UPDATE/DELETE in event-log code | `grep -rn "UPDATE\|DELETE" src/storage/event-log.ts` = 0 |
| ID-01 | All IDs use correct prefix | 100% correct | `bun test` prefix validation tests |
| ID-02 | Promotions carry sourceRefs | 100% populated | Handoff builder tests |
| PROMO-01 | Handoff has required fields | Zod validation passes | Schema tests |
| EDDA-01 | Auto triggers fire | 8/8 correct | Trigger evaluator tests |
| EDDA-03 | Never events dropped | 8/8 silently skipped | Trigger evaluator tests |
| THY-01 | TypeScript strict mode | Zero tsc errors | `bun run build` across all repos |
| THY-11 | API response format | `{ ok, data/error }` | Route tests |
