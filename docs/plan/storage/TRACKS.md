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
> 📍 **REDIRECT**: Track A 由 `volva/docs/plan-world-design/TRACK_A_DECISION_STATE/` 實作。
> 原本的 `volva/docs/plan/storage/TRACK_A_VOLVA_WORKING_STATE.md` 已廢棄刪除。
```
A1_ZOD_SCHEMAS.md              ← All shared types in src/schemas/decision.ts
A2_DB_SCHEMA.md                ← 8 tables appended to existing initSchema() in src/db.ts
A3_SESSION_MANAGER.md          ← DecisionSessionManager with stage machine + CRUD helpers
```
> **ID convention note**: Völva uses `crypto.randomUUID()` producing `<prefix>_<uuid>` format.
> Thyra's Track B uses `nanoid(12)` producing `<prefix>_<nanoid>` format.
> Both share the same prefix map (`ds_`, `cand_`, `probe_`, etc.).
> Cross-layer `validateIdPrefix()` must accept both random part formats.

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

> **⚠️ REDIRECT — 此 Track 由 Völva 的 plan-world-design 實作。**
> 完整 task files: `volva/docs/plan-world-design/TRACK_A_DECISION_STATE/`（A1, A2, A3）
> 本節只保留 summary 和 cross-plan interface contract。

**Layer**: L0
**Goal**: Build Völva's L1 persistent working state — 8 SQLite tables + Zod schemas + session manager
**Repo**: `C:\ai_agent\volva`

**Output（由 Völva plan-world-design Track A 產出）**:
- `src/schemas/decision.ts` — 所有 shared types 的 Zod schemas（single file）
- `src/db.ts` 擴展 — 8 new tables appended to existing `initSchema()`
- `src/decision/session-manager.ts` — DecisionSessionManager with stage machine

**Cross-plan interface contract（Track B-E 依賴這些）**:
- ID prefixes: `ds_`, `card_`, `cand_`, `probe_`, `sig_`, `commit_`, `promo_`, `evt_`
- ID format: `<prefix>_<crypto.randomUUID()>` — random part 是 UUID 格式
- Event types: 11 values in `decision_events.event_type` CHECK constraint
- Stage enum: 9 values in `decision_sessions.stage` CHECK constraint
- API: `POST /api/decisions/*`（not `/api/storage/*`）

**Dependencies**:
- blocks: B, C, D, E
- blocked-by: none

**Smoke Test**:
```bash
cd C:/ai_agent/volva
bun run build
bun test src/decision/session-manager.test.ts
bun test src/schemas/decision.test.ts
```

**Task Count**: 3（see `volva/docs/plan-world-design/TRACK_A_DECISION_STATE/`）

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
Völva (implemented by plan-world-design Track A):
  schemas/decision ← decision/session-manager ← routes/decisions

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
