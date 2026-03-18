# Decision State Storage — Planning Pack

## Goal

把 `docs/storage/` architecture spec stack 工程化為可運行的跨 repo 基礎設施：
- **可持久化（persistable）** 的 Völva working decision state（L1 DB）
- **可追蹤（traceable）** 的跨層 ID 與 SourceRef 機制
- **可升格（promotable）** 的 handoff packaging + checklist + rollback
- **可記憶（recordable）** 的 Edda ingestion trigger engine

## Scope

本 planning pack 只涵蓋 storage spec stack 定義的四個工程面向。
不涵蓋：Thyra world runtime（canonical-cycle）、Völva intent-router、Karvi dispatch。

## Dependency DAG

```
L0 基礎設施
  [A] Völva Working State DB (Völva repo)
   │
   ▼
L1 跨層基礎
  [B] Cross-Layer ID Infrastructure
   │
   ├──────────────────────┐
   ▼                      ▼
L2 升格機制              L2 記憶機制
  [C] Promotion Engine   [D] Edda Ingestion Engine
   │
   ▼
  [E] Promotion Rollback
```

**關鍵依賴說明**：
- A 是所有 Track 的前提（L1 schema 定義 ID prefixes 和 event 格式）
- B 依賴 A（SourceRef 的 L1 層 ID 從 A 的 prefix convention 來）
- C 和 D 皆依賴 B（promotion 和 ingestion 都用 SourceRef），可並行
- E 依賴 C（rollback 需要 handoff object 才能回指）

## Track Summary

| Track | Name | Layer | Tasks | Dependencies | Repo | Status |
|-------|------|-------|-------|-------------|------|--------|
| A | Völva Working State DB | L0 | 3 | — | Völva | ☐ |
| B | Cross-Layer ID Infrastructure | L1 | 2 | A | Thyra (shared) | ☐ |
| C | Promotion Engine | L2 | 3 | B | Thyra | ☐ |
| D | Edda Ingestion Engine | L2 | 3 | B | Edda/Thyra | ☐ |
| E | Promotion Rollback | L2 | 2 | C | Thyra | ☐ |

**Total: 5 Tracks, 13 Tasks**

## Parallel Execution Timeline

```
Batch 1（無依賴）：
  Agent 1 → Track A: A1 → A2 → A3

Batch 2（依賴 A）：
  Agent 1 → Track B: B1 → B2

Batch 3（依賴 B，可並行）：
  Agent 1 → Track C: C1 → C2 → C3
  Agent 2 → Track D: D1 → D2 → D3

Batch 4（依賴 C）：
  Agent 1 → Track E: E1 → E2
```

## Progress Tracking

### Batch 1
- [ ] Track A: Völva Working State DB
  - [ ] A1: Schema + DB initialization
  - [ ] A2: CRUD operations for all 7 entity types
  - [ ] A3: Decision event log + routes + tests

### Batch 2
- [ ] Track B: Cross-Layer ID Infrastructure
  - [ ] B1: SourceRef type + ID prefix utilities
  - [ ] B2: SourceRef validation + tests

### Batch 3
- [ ] Track C: Promotion Engine
  - [ ] C1: Promotion handoff schema + builder
  - [ ] C2: Promotion checklist evaluator
  - [ ] C3: Handoff packaging + routes + tests
- [ ] Track D: Edda Ingestion Engine
  - [ ] D1: Trigger tables + evaluation engine
  - [ ] D2: Suggestion queue + workflow
  - [ ] D3: Ingestion routes + tests

### Batch 4
- [ ] Track E: Promotion Rollback
  - [ ] E1: Rollback memo + suspended state
  - [ ] E2: Rollback flow + routes + tests

## Module Map

### Völva repo (Track A)
```
src/
  storage/
    db.ts                          ← A1: createStorageDb, initStorageSchema
    schemas/
      decision-session.ts          ← A1: DecisionSession Zod schema
      card-snapshot.ts             ← A1: CardSnapshot Zod schema
      candidate-record.ts          ← A1: CandidateRecord Zod schema
      probe-record.ts              ← A1: ProbeRecord Zod schema
      signal-packet.ts             ← A1: SignalPacket Zod schema
      commit-memo-draft.ts         ← A1: CommitMemoDraft Zod schema
      promotion-check-draft.ts     ← A1: PromotionCheckDraft Zod schema
      decision-event.ts            ← A1: DecisionEvent Zod schema
    session-store.ts               ← A2: DecisionSessionStore CRUD
    candidate-store.ts             ← A2: CandidateRecordStore CRUD
    probe-store.ts                 ← A2: ProbeRecordStore CRUD
    event-log.ts                   ← A3: DecisionEventLog append + query
    routes/
      storage.ts                   ← A3: Storage API routes
```

### Thyra repo (Track B, C, E)
```
src/
  cross-layer/
    source-ref.ts                  ← B1: SourceRef type + ID prefix utils
    id-validator.ts                ← B2: validateSourceRef, validateIdPrefix
  promotion/
    schemas/
      handoff.ts                   ← C1: PromotionHandoff Zod schema
      checklist.ts                 ← C2: PromotionChecklist schema
      rollback.ts                  ← E1: PromotionRollbackMemo schema
    handoff-builder.ts             ← C1: buildPromotionHandoff()
    checklist-evaluator.ts         ← C2: evaluatePromotionChecklist()
    handoff-packager.ts            ← C3: packageHandoff() → JSON files
    rollback-engine.ts             ← E1: createRollbackMemo, markSuspended
    routes/
      promotion.ts                 ← C3: Promotion API routes
      rollback.ts                  ← E2: Rollback API routes
```

### Edda repo (Track D)
```
src/
  ingestion/
    schemas/
      ingestion-record.ts          ← D1: EddaIngestionRecord Zod schema
      suggestion.ts                ← D2: EddaSuggestion Zod schema
    trigger-tables.ts              ← D1: auto/suggest/never trigger definitions
    trigger-evaluator.ts           ← D1: evaluateTrigger(event) → auto|suggest|skip
    suggestion-queue.ts            ← D2: SuggestionQueue CRUD + accept/reject
    ingestion-writer.ts            ← D1: writeIngestionRecord()
    routes/
      ingestion.ts                 ← D3: Ingestion API routes
```

## Type Registry

所有 TypeScript 型別的正式清單（跨所有 Track）。

| Type | Introduced | Source Spec | Repo |
|------|-----------|-------------|------|
| `DecisionSession` | A1 | volva-working-state-schema-v0.md | Völva |
| `CardSnapshot` | A1 | volva-working-state-schema-v0.md | Völva |
| `CandidateRecord` | A1 | volva-working-state-schema-v0.md | Völva |
| `ProbeRecord` | A1 | volva-working-state-schema-v0.md | Völva |
| `SignalPacket` | A1 | volva-working-state-schema-v0.md | Völva |
| `CommitMemoDraft` | A1 | volva-working-state-schema-v0.md | Völva |
| `PromotionCheckDraft` | A1 | volva-working-state-schema-v0.md | Völva |
| `DecisionEvent` | A1 | volva-working-state-schema-v0.md | Völva |
| `Regime` | A1 | volva-working-state-schema-v0.md | Völva |
| `SourceRef` | B1 | cross-layer-ids-v0.md | Thyra |
| `PromotionHandoff` | C1 | promotion-handoff-schema-v0.md | Thyra |
| `StableObjectRef` | C1 | promotion-handoff-schema-v0.md | Thyra |
| `SourceLink` | C1 | promotion-handoff-schema-v0.md | Thyra |
| `ProjectPlanPayload` | C1 | promotion-handoff-schema-v0.md | Thyra |
| `ThyraRuntimePayload` | C1 | promotion-handoff-schema-v0.md | Thyra |
| `PromotionChecklist` | C2 | promotion-handoff-schema-v0.md | Thyra |
| `PromotionRollbackMemo` | E1 | promotion-rollback-v0.md | Thyra |
| `EddaIngestionRecord` | D1 | edda-ingestion-triggers-v0.md | Edda |
| `EddaSuggestion` | D2 | edda-ingestion-triggers-v0.md | Edda |
