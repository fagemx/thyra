# Decision State Storage — Track Definitions

## Layer Definitions

- **L0 基礎設施**：Völva working state DB — 所有 decision state 的持久化基礎
- **L1 跨層基礎**：SourceRef + ID prefix — 跨層追蹤的通用機制
- **L2 升格/記憶機制**：Promotion engine + Edda ingestion — 狀態升格與 precedent 記錄

## DAG

```
L0 基礎設施
  [A] Völva Working State DB (Völva repo)
   │
   ▼
L1 跨層基礎
  [B] Cross-Layer ID Infrastructure (Thyra)
   │
   ├──────────────────────┐
   ▼                      ▼
L2 升格機制              L2 記憶機制
  [C] Promotion Engine   [D] Edda Ingestion Engine
  (Thyra)                (Edda)
   │
   ▼
  [E] Promotion Rollback (Thyra)
```

## Track → Step Mapping

### A: Völva Working State DB（L0, Völva repo）
> 📍 完整 task file 在 `volva/docs/plan/storage/TRACK_A_VOLVA_WORKING_STATE.md`
```
Step 1: Schema + DB init (8 tables + Zod schemas)
Step 2: CRUD operations (7 entity stores)
Step 3: Event log + routes + tests
```

### B: Cross-Layer ID Infrastructure（L1, Thyra repo）
```
TRACK_B_CROSS_LAYER_IDS/
  B1_SOURCE_REF_AND_PREFIXES.md    ← SourceRef type + ID generation utils + prefix map
  B2_VALIDATION_AND_TESTS.md       ← validateSourceRef + validateIdPrefix + tests
```

### C: Promotion Engine（L2, Thyra repo）
```
TRACK_C_PROMOTION_ENGINE/
  C1_HANDOFF_SCHEMA_BUILDER.md     ← PromotionHandoff + StableObjectRef + SourceLink + builder
  C2_CHECKLIST_EVALUATOR.md        ← PromotionChecklist + evaluator for project-plan + thyra-runtime
  C3_PACKAGING_ROUTES_TESTS.md     ← packageHandoff() + API routes + tests
```

### D: Edda Ingestion Engine（L2, Edda repo, **Rust**）
> 📍 完整 task file 在 `edda/docs/plan/storage/TRACK_D_EDDA_INGESTION.md`
> ⚠️ Edda 是 Rust crate，不是 TypeScript。
```
Step 1: Trigger tables + evaluator + ingestion writer (Rust)
Step 2: Suggestion queue with accept/reject (Rust)
Step 3: API routes + integration tests (Rust)
```

### E: Promotion Rollback（L2, Thyra repo）
```
TRACK_E_PROMOTION_ROLLBACK/
  E1_ROLLBACK_SCHEMA_ENGINE.md     ← PromotionRollbackMemo + createRollbackMemo + markSuspended
  E2_ROUTES_AND_TESTS.md           ← Rollback API routes + tests
```

---

## Track A: Völva Working State DB

**Layer**: L0
**Goal**: Build Völva's L1 persistent working state — 8 SQLite tables covering sessions, cards, candidates, probes, signals, commit memos, promotion checks, and decision events.
**Repo**: `C:\ai_agent\volva`

**Input**:
- `volva/docs/storage/volva-working-state-schema-v0.md` (canonical schema)
- Existing Völva DB patterns (if any)

**Output**:
- 8 Zod schemas in `src/storage/schemas/`
- `createStorageDb()` + `initStorageSchema()` in `src/storage/db.ts`
- CRUD stores for all 7 entity types
- Append-only `DecisionEventLog`
- Storage API routes with tests

**Dependencies**:
- blocks: B, C, D, E
- blocked-by: none (can start immediately)

**DoD**:
- [ ] `bun run build` zero errors in Völva repo
- [ ] All 8 tables created on `initStorageSchema()`
- [ ] CRUD for sessions, cards, candidates, probes, signals, memos, promotions
- [ ] Event log is append-only (no UPDATE/DELETE)
- [ ] All IDs use correct prefixes (`ds_`, `card_`, `cand_`, `probe_`, `sig_`, `commit_`, `promo_`, `evt_`)
- [ ] API routes return `{ ok: true, data }` format
- [ ] Tests pass with `:memory:` SQLite

**Smoke Test**:
```bash
cd C:/ai_agent/volva
bun run build
bun test src/storage/
```

**Task Count**: 3

---

## Track B: Cross-Layer ID Infrastructure

**Layer**: L1
**Goal**: Build the `SourceRef` type and ID prefix utilities that all cross-layer operations depend on.
**Repo**: `C:\ai_agent\thyra`

**Input**:
- `docs/storage/cross-layer-ids-v0.md` (SourceRef spec, prefix convention)
- Track A's ID prefix usage as validation target

**Output**:
- `SourceRef` Zod schema with all 6 layer values
- `generateId(prefix)` utility
- `validateSourceRef()` + `validateIdPrefix()` functions
- Tests covering all prefix conventions

**Dependencies**:
- blocks: C, D, E
- blocked-by: A (conceptual — needs to verify ID prefix convention matches A's implementation. No code import from Völva needed.)

**DoD**:
- [ ] `bun run build` zero errors
- [ ] `SourceRef` type validates layer + kind + id
- [ ] `generateId("ds")` produces `ds_<nanoid>` format
- [ ] All storage-scope prefixes (L1 + promotion + L5) have test coverage
- [ ] Invalid prefixes are rejected

**Smoke Test**:
```bash
bun run build
bun test src/cross-layer/
```

**Task Count**: 2

---

## Track C: Promotion Engine

**Layer**: L2
**Goal**: Build the promotion handoff flow — schema validation, checklist evaluation, and package generation for `arch-spec → project-plan` and `arch-spec → thyra-runtime`.
**Repo**: `C:\ai_agent\thyra`

**Input**:
- `docs/storage/promotion-handoff-schema-v0.md` (canonical schema)
- Track B's `SourceRef` type
- `docs/storage/persistence-policy-v0.md` §10 (promotion policy)

**Output**:
- `PromotionHandoff` + payload variant Zod schemas
- `buildPromotionHandoff()` builder function
- `evaluatePromotionChecklist()` with per-target-layer criteria
- `packageHandoff()` → generates `handoff.json` + `checklist.json`
- Promotion API routes + tests

**Dependencies**:
- blocks: E
- blocked-by: B (needs SourceRef + ID utilities)

**DoD**:
- [ ] `bun run build` zero errors
- [ ] `PromotionHandoff` schema validates both `ProjectPlanPayload` and `ThyraRuntimePayload`
- [ ] Checklist evaluator has specific items for project-plan vs thyra-runtime targets
- [ ] `packageHandoff()` produces valid JSON files
- [ ] Empty `stableObjects` is rejected (PROMO-01)
- [ ] API routes return `{ ok: true, data }` format
- [ ] Tests cover: valid handoff, missing fields rejection, checklist pass/fail

**Smoke Test**:
```bash
bun run build
bun test src/promotion/
```

**Task Count**: 3

---

## Track D: Edda Ingestion Engine

**Layer**: L2
**Goal**: Build the trigger evaluation engine that decides which events auto-write to Edda, which get queued for review, and which are dropped.
**Repo**: `C:\ai_agent\edda`

**Input**:
- `docs/storage/edda-ingestion-triggers-v0.md` (trigger tables, record schema)
- Track B's `SourceRef` type
- Existing Edda DB/API patterns

**Output**:
- `EddaIngestionRecord` + `EddaSuggestion` Zod schemas
- Trigger tables (auto/suggest/never) as code constants
- `evaluateTrigger(event)` → `"auto" | "suggest" | "skip"`
- `SuggestionQueue` CRUD with accept/reject workflow
- Ingestion API routes + tests

**Dependencies**:
- blocks: none (leaf track)
- blocked-by: B (needs SourceRef type)

**DoD**:
- [ ] `cargo build -p edda-ingestion` zero errors in Edda repo
- [ ] All 9 auto-ingest triggers fire correctly
- [ ] All 8 suggest-ingest triggers queue correctly
- [ ] All 8 never-ingest events are silently dropped
- [ ] Accepted suggestions become normal records
- [ ] Rejected suggestions are discarded (not written)
- [ ] Every record has `sourceRefs` populated
- [ ] Tests cover: auto → writes, suggest → queues, never → skips

**Smoke Test**:
```bash
cd C:/ai_agent/edda
cargo build -p edda-ingestion
cargo test -p edda-ingestion
```

**Task Count**: 3

---

## Track E: Promotion Rollback

**Layer**: L2
**Goal**: Build the safe rollback mechanism for premature promotions — producing rollback memos, marking downstream as suspended, and recording to Edda.
**Repo**: `C:\ai_agent\thyra`

**Input**:
- `docs/storage/promotion-rollback-v0.md` (rollback schema)
- Track C's `PromotionHandoff` (the thing being rolled back)
- Track D's ingestion interface (rollback is auto-ingest trigger)

**Output**:
- `PromotionRollbackMemo` Zod schema
- `createRollbackMemo()` builder
- `markSuspended()` for planning packs and runtime worlds
- Rollback API routes + tests

**Dependencies**:
- blocks: none (leaf track)
- blocked-by: C (needs promotion handoff to roll back)

**DoD**:
- [ ] `bun run build` zero errors
- [ ] Rollback memo references `originalHandoffId` (PROMO-03)
- [ ] Downstream marked `suspended`, never `deleted` (PROMO-02)
- [ ] Rollback triggers Edda auto-ingest (via Track D's interface)
- [ ] Tests cover: Type A (project-plan → arch-spec), Type B (thyra-runtime → arch-spec)

**Smoke Test**:
```bash
bun run build
bun test src/promotion/rollback-engine.test.ts
```

**Task Count**: 2

---

## Cross-Module Dependency Graph

```
Völva:
  storage/db ← storage/schemas/* ← storage/*-store ← storage/event-log ← storage/routes

Thyra:
  cross-layer/source-ref ← cross-layer/id-validator
  cross-layer/source-ref ← promotion/schemas/* ← promotion/handoff-builder
                                                ← promotion/checklist-evaluator
                                                ← promotion/handoff-packager ← promotion/routes
  promotion/schemas/rollback ← promotion/rollback-engine ← promotion/routes/rollback

Edda:
  cross-layer/source-ref (imported from Thyra or shared)
  ingestion/schemas/* ← ingestion/trigger-tables ← ingestion/trigger-evaluator
                     ← ingestion/suggestion-queue ← ingestion/routes
```

**Rule**: Lower layers cannot import upper layers. `cross-layer/` is shared infrastructure, importable by all.
