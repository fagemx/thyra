# World Governance Cycle — Track Definitions

## Layer Definitions

- **L0 觀察層**：ObservationBatch — 從 world state / events / external 建立結構化觀察
- **L1 提案層**：Change Proposal Extensions — 擴展已有 change/judge 加入 canonical lifecycle
- **L2 循環+感知層**：Cycle Runner + Pulse Emitter — 10 階段循環 + 世界脈搏
- **L3 後果+學習層**：Outcome Collector + Precedent Recorder — 後果判定 + precedent 寫入
- **L4 調適層**：Governance Adjustment — outcome 驅動的 law/chief 調整
- **L5 API 層**：Canonical Cycle Routes — 完整 REST API 映射

## DAG

```
L0 觀察層
  [A] Observation Builder
   │
   ├──────────────────────┐
   ▼                      ▼
L1 提案層               L2 感知層
  [B] Change Proposal    [D] Pulse Emitter
  Extensions
   │
   ▼
L2 循環層
  [C] Cycle Runner
   │
   ├──────────────────────┐
   ▼                      ▼
L3 後果層               L3 學習層
  [E] Outcome Collector  [F] Precedent Recorder
   │
   ▼
L4 調適層
  [G] Governance Adjustment Engine
   │
   ▼
L5 API 層
  [H] Canonical Cycle API Routes
```

---

## Track A: Observation Builder

**Layer**: L0
**Goal**: Build structured observation batches from world state diffs, external events, and chief inspection results.

**Input**:
- `canonical-cycle.md` §4.1 (OBSERVE stage)
- Existing `src/world/state.ts`, `src/world/diff.ts`

**Output**:
- `src/canonical-cycle/observation-builder.ts`
- `src/schemas/observation.ts` (ObservationBatch Zod schema)

**Dependencies**:
- blocks: B, C, D
- blocked-by: none

**DoD**:
- [ ] `bun run build` zero errors
- [ ] ObservationBatch schema includes: source, timestamp, scope, importance, observations array
- [ ] Builder aggregates from state diffs + audit log + external events
- [ ] Tests with `:memory:` SQLite

**Task Count**: 2

---

## Track B: Change Proposal Extensions

**Layer**: L1
**Goal**: Extend existing `src/world/proposal.ts` and `src/world/judge.ts` with the canonical proposal lifecycle (draft → proposed → judged → approved/rejected → applied → outcome) and ProposalBundle for multi-change submissions.

**Input**:
- `change-proposal-schema-v0.md` (lifecycle, schema, governance block)
- Existing `src/world/proposal.ts`, `src/world/judge.ts`

**Output**:
- Extended proposal lifecycle state machine
- ProposalBundle support
- Simulation hooks (dry-run judgment)

**Dependencies**:
- blocks: C
- blocked-by: A (needs observations to drive proposals)

**DoD**:
- [ ] `bun run build` zero errors
- [ ] Proposal lifecycle state machine enforces valid transitions
- [ ] 4-layer judgment stack runs in order (JUDGE-01)
- [ ] Verdict is always one of 6 values (JUDGE-02)
- [ ] ProposalBundle groups related proposals
- [ ] Tests cover: valid transitions, invalid transitions rejected, all 6 verdicts

**Task Count**: 2

---

## Track C: Cycle Runner

**Layer**: L2
**Goal**: Build the canonical 10-stage cycle orchestrator that ties observe → propose → judge → apply → pulse → outcome → precedent → adjust into a repeatable, timed loop.

**Input**:
- `canonical-cycle.md` §4 (10 stages), §12 (MVP slice cadence)
- Track A (observation), Track B (proposals/judgment), existing apply/rollback

**Output**:
- `src/canonical-cycle/cycle-runner.ts` — orchestrator
- `src/schemas/cycle-run.ts` — CycleRun Zod schema
- `src/canonical-cycle/cycle-cadence.ts` — timer/interval

**Dependencies**:
- blocks: E, F, G, H
- blocked-by: B

**DoD**:
- [ ] `bun run build` zero errors
- [ ] CycleRun tracks all 10 stage timestamps
- [ ] Stages execute in fixed order (CYCLE-01)
- [ ] Cadence is configurable, default 15min (CYCLE-03)
- [ ] Cycle produces structured CycleRun artifact
- [ ] Tests: full cycle completion, stage ordering enforcement, cadence configuration

**Task Count**: 3

---

## Track D: Pulse Emitter

**Layer**: L2
**Goal**: Build the PulseFrame builder that computes world health from 5 base metrics and emits structured pulse after every change application.

**Input**:
- `pulse-and-outcome-metrics-v0.md` §5-13 (5 metrics, weights, mode-aware)
- Existing `src/world/health.ts`
- `shared-types.md` §6.8 (PulseFrame)

**Output**:
- `src/canonical-cycle/pulse-emitter.ts`
- PulseFrame with healthScore, mode, stability, dominantConcerns

**Dependencies**:
- blocks: H
- blocked-by: A (needs observation context for pulse)

**DoD**:
- [ ] `bun run build` zero errors
- [ ] PulseFrame includes healthScore, mode, stability, dominantConcerns (PULSE-01)
- [ ] Pulse emits after every apply (PULSE-02)
- [ ] 5 metrics weighted by WorldMode
- [ ] Concern.severity uses 4 values (low/medium/high/critical)
- [ ] Tests: normal pulse, peak mode weights, critical concern generation

**Task Count**: 2

---

## Track E: Outcome Collector

**Layer**: L3
**Goal**: Build outcome windows that track metric deltas after a change is applied, and produce OutcomeReports with verdicts (beneficial/neutral/harmful/inconclusive).

**Input**:
- `pulse-and-outcome-metrics-v0.md` §14-23 (outcome semantics)
- `shared-types.md` §6.9 (OutcomeReport)
- Track C (cycle provides the apply→outcome transition)

**Output**:
- `src/canonical-cycle/outcome-window.ts` — lifecycle (open → evaluating → closed)
- `src/canonical-cycle/outcome-evaluator.ts` — baseline vs observed comparison
- `src/canonical-cycle/outcome-report-builder.ts` — OutcomeReport construction

**Dependencies**:
- blocks: F, G
- blocked-by: C

**DoD**:
- [ ] `bun run build` zero errors
- [ ] OutcomeWindow has explicit open/close lifecycle (OUTCOME-01)
- [ ] OutcomeReport compares baseline vs observed with delta (OUTCOME-02)
- [ ] OutcomeVerdict: beneficial/neutral/harmful/inconclusive
- [ ] OutcomeRecommendation: reinforce/retune/watch/rollback/do_not_repeat
- [ ] SideEffectResult.severity: negligible/minor/significant
- [ ] Tests: beneficial outcome, harmful outcome, inconclusive, side effects

**Task Count**: 3

---

## Track F: Precedent Recorder

**Layer**: L3
**Goal**: Build the precedent recording pipeline that creates PrecedentRecords from completed outcomes and sends them to Edda.

**Input**:
- `shared-types.md` §6.10 (PrecedentRecord)
- `edda-ingestion-triggers-v0.md` (what triggers auto-ingest)
- Track E (OutcomeReport as input)

**Output**:
- `src/canonical-cycle/precedent-recorder.ts`
- Edda bridge integration for precedent writeback

**Dependencies**:
- blocks: H
- blocked-by: C, E

**DoD**:
- [ ] `bun run build` zero errors
- [ ] PrecedentRecord links to proposalId + outcomeReportId (PREC-01)
- [ ] Precedent is append-only (PREC-02)
- [ ] Sends to Edda via existing edda-bridge (fire-and-forget)
- [ ] Tests: precedent creation, field validation, Edda bridge call

**Task Count**: 2

---

## Track G: Governance Adjustment Engine

**Layer**: L4
**Goal**: Build the engine that produces GovernanceAdjustments when outcomes indicate harmful results or need for policy/law/chief changes.

**Input**:
- `shared-types.md` §6.11 (GovernanceAdjustment)
- Track E (OutcomeReport verdict + recommendation)

**Output**:
- `src/canonical-cycle/governance-adjuster.ts`
- `src/schemas/governance-adjustment.ts`

**Dependencies**:
- blocks: H
- blocked-by: E

**DoD**:
- [ ] `bun run build` zero errors
- [ ] Adjustment fires when verdict=harmful or recommendation=rollback/retune (ADJ-02)
- [ ] Adjustment specifies target + before/after (ADJ-01)
- [ ] adjustmentType: law_threshold / chief_permission / chief_style / risk_policy / simulation_policy
- [ ] Tests: harmful outcome → adjustment, neutral → no adjustment, adjustment schema validation

**Task Count**: 2

---

## Track H: Canonical Cycle API Routes

**Layer**: L5
**Goal**: Build the complete REST API that maps every canonical cycle stage to an endpoint, matching `world-cycle-api.md`.

**Input**:
- `world-cycle-api.md` (all routes)
- All tracks A-G (the modules being exposed)
- Existing `src/routes/world.ts` (extend or parallel)

**Output**:
- `src/routes/cycles.ts` — cycle management
- `src/routes/observations.ts` — observation routes
- `src/routes/outcomes.ts` — outcome + precedent routes
- `src/routes/adjustments.ts` — governance adjustment routes

**Dependencies**:
- blocks: none (leaf)
- blocked-by: all other tracks

**DoD**:
- [ ] `bun run build` zero errors
- [ ] All routes match world-cycle-api.md paths (API-02)
- [ ] All routes use THY-11 envelope (API-01)
- [ ] All 10 canonical cycle stages have corresponding endpoints
- [ ] Integration test: create world → start cycle → observe → propose → judge → apply → pulse → outcome → precedent → adjust → next cycle
- [ ] Tests with `:memory:` SQLite

**Task Count**: 3

---

## Cross-Module Dependency Graph

```
existing modules (don't touch):
  world/state ← world/change ← world/judge ← world/rollback
  world/snapshot ← world/continuity
  world/health
  chief-engine ← loop-runner
  governance-scheduler

new canonical-cycle modules:
  observation-builder ← cycle-runner → pulse-emitter
                      ↓
                      outcome-window ← outcome-evaluator ← outcome-report-builder
                      ↓
                      precedent-recorder → edda-bridge
                      ↓
                      governance-adjuster

routes:
  routes/cycles ← cycle-runner
  routes/observations ← observation-builder
  routes/outcomes ← outcome-window + outcome-report-builder
  routes/adjustments ← governance-adjuster
```

**Rule**: New `canonical-cycle/` modules import from existing `world/` modules. Existing modules do NOT import from `canonical-cycle/`. This preserves the existing codebase.
