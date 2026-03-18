# Decision State Storage — Architecture Constraints

> These rules cannot be violated during development.
> Any task that violates these rules is considered incomplete.
> Derived from `docs/storage/` spec stack + Thyra CLAUDE.md.

## Rules

| Rule ID | Description | Verification | Affected Tracks |
|---------|------------|--------------|-----------------|
| STORE-01 | Working state (L1) uses snapshot-overwrite + append-only dual track | Code review: current tables overwrite, `decision_events` is append-only | A |
| STORE-02 | Spec docs (L2) are Git-backed only — no silent DB sync | Code review: no L1→L2 auto-sync path | All |
| STORE-03 | Edda (L5) is append-only — no modify, no delete of precedent records | Code review: no UPDATE/DELETE on ingestion records | D |
| ID-01 | All objects use stable ID prefixes per layer. L1: `ds_`, `card_`, `cand_`, `probe_`, `sig_`, `commit_`, `promo_`, `evt_`. Promotion: `handoff_`, `rollback_`. Edda: `prec_`, `dec_`, `sug_`. | `grep` all ID generation for correct prefix | A, B |
| ID-02 | Every cross-layer promotion carries `sourceRefs` pointing upstream | Code review: handoff builder always populates `sourceRefs` | B, C, E |
| ID-03 | SourceRef.layer must be one of `"L0" \| "L1" \| "L2" \| "L3" \| "L4" \| "L5"` | Zod schema validation | B |
| PROMO-01 | Promotion handoff requires `promotionVerdict` + `stableObjects` + `sourceLinks` | Zod `.safeParse()` on handoff object | C |
| PROMO-02 | Rollback marks downstream as `suspended`, never `deleted` | Code review: no DELETE on rollback path | E |
| PROMO-03 | Rollback preserves ID chain — `originalHandoffId` always populated | Code review: rollback memo references original | E |
| EDDA-01 | 9 auto-ingest triggers fire without human confirmation | Code review: auto triggers write directly | D |
| EDDA-02 | Suggest-ingest queues for human review before writing | Code review: suggest triggers create `EddaSuggestion` with status=pending | D |
| EDDA-03 | Never-ingest events are silently dropped — no queue, no log | Code review: never-list events are skipped | D |
| WIRE-01 | Cross-language types (SourceRef, IngestionRecord) must conform to shared JSON schema | JSON schema validation test | B, D |
| THY-01 | TypeScript `strict: true`, no `any`, no `!` assertions | `bun run build` zero errors | All |
| THY-04 | All entities have `id`, `created_at` | Schema review | A, C, D, E |
| THY-11 | API response: `{ ok: true, data }` or `{ ok: false, error: { code, message } }` | Route tests | A, C, D, E |
| ZOD-01 | All input validation uses Zod `.safeParse()` | Code review: no raw JSON.parse on external input | All |

---

## Detailed Rules

### STORE-01: Dual-Track Persistence for L1

**Description**: Völva working state uses two persistence modes simultaneously: snapshot-overwrite for current-state tables (sessions, candidates, probes, etc.) and append-only for the `decision_events` table.

**Rationale**: Current state needs fast reads; event history needs tamper-evident audit trail.

**Verification**: Confirm `decision_events` has no UPDATE/DELETE operations; confirm other tables use upsert patterns.

**Consequence of violation**: Either lose audit trail (if events are overwritten) or get stale reads (if snapshots aren't updated).

---

### ID-01: Stable ID Prefixes

**Description**: Every L1 object must use the prefix convention from `cross-layer-ids-v0.md` §3. ID generation must produce `<prefix>_<random>` format.

**Rationale**: IDs must be recognizable by layer and type at a glance, and stable across promotions.

**Verification**:
```bash
grep -rn "generateId\|nanoid\|uuid" src/storage/ src/cross-layer/ src/promotion/
# Every call must include the correct prefix
```

**Consequence of violation**: Cross-layer tracing breaks; SourceRef.kind can't be inferred from ID alone.

---

### PROMO-01: Handoff Schema Completeness

**Description**: Every promotion must produce a `PromotionHandoff` object that passes Zod validation. The `stableObjects` array must be non-empty; `sourceLinks` must trace back to at least one source session or spec.

**Rationale**: Without structured handoff, promotion degrades to "feels ready enough" — the exact failure the storage spec stack was designed to prevent.

**Verification**:
```bash
bun test src/promotion/handoff-builder.test.ts
# All tests pass, including empty-stableObjects rejection
```

**Consequence of violation**: project-plan or thyra-runtime receives an incomplete handoff; downstream work starts on unstable foundations.

---

### EDDA-01/02/03: Three Ingestion Modes

**Description**: Events are classified into exactly one of: auto-ingest (write immediately), suggest-ingest (queue for review), never-ingest (drop). Classification is based on the trigger tables in `edda-ingestion-triggers-v0.md` §4-6.

**Rationale**: Without ingestion discipline, Edda becomes a noise dump. Without auto-ingest, critical decisions get lost.

**Verification**:
```bash
bun test src/ingestion/trigger-evaluator.test.ts
# Verify: commit memo → auto, route change → suggest, follow-up draft → skip
```

**Consequence of violation**: Edda either drowns in noise (too much) or misses critical precedents (too little).

---

### WIRE-01: Cross-Language JSON Wire Format

**Description**: Types shared between TypeScript (Thyra) and Rust (Edda) — specifically `SourceRef` and `EddaIngestionRecord` — must serialize to the same JSON shape. Field names use camelCase on the wire (TypeScript convention); Rust uses `serde(rename_all = "camelCase")`.

**Rationale**: Without a shared wire format, Thyra and Edda will produce/consume incompatible JSON.

**Verification**: Both sides validate against the same JSON test fixtures.

**Consequence of violation**: Cross-repo ingestion calls fail silently or with deserialization errors.
