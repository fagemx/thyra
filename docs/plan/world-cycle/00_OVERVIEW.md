# World Governance Cycle — Planning Pack

## Goal

把 `docs/world-design-v0/` 的 canonical cycle spec 工程化為可運行的世界治理 runtime：
- **可循環（cycleable）** 的 10 階段治理循環（observe → propose → judge → apply → pulse → outcome → precedent → adjust → next）
- **可觀察（observable）** 的結構化 PulseFrame + Outcome Report
- **可學習（learnable）** 的 precedent recording + governance adjustment
- **可對齊（aligned）** 的 API routes 映射 canonical cycle 每一階段

## Scope

本 planning pack 在現有 Thyra codebase 基礎上建設。

**已存在的 building blocks**（不重建）：
- `src/world/` — state, change, judge, rollback, snapshot, diff, proposal, continuity, health, evaluator
- `src/world-manager.ts` — WorldManager
- `src/chief-engine.ts` — Chief profiles + proposal generation
- `src/loop-runner.ts` — basic loop execution
- `src/governance-scheduler.ts` — scheduling
- `src/decision-engine.ts` — decision logic
- `src/routes/world.ts` — existing world API routes

**本 pack 新建的**（canonical cycle 缺口）：
- Observation Builder — 結構化觀察批次
- Cycle Runner — 10 階段循環 orchestrator
- Pulse Emitter — 世界健康 → PulseFrame
- Outcome Collector — outcome windows + metric 比較
- Precedent Recorder — change→outcome traces
- Governance Adjustment Engine — outcome→law/chief 調整
- Canonical Cycle API — 完整 REST routes 對齊 world-cycle-api.md

## Dependency DAG

```
L0 觀察層
  [A] Observation Builder
   │
   ▼
L1 提案 + 判斷層（已存在，本 pack 擴展）
  [B] Change Proposal Extensions
   │
   ▼
L2 循環 + 感知層
  [C] Cycle Runner         [D] Pulse Emitter
   │                        │
   ▼                        ▼
L3 後果 + 學習層
  [E] Outcome Collector    [F] Precedent Recorder
   │
   ▼
L4 調適層
  [G] Governance Adjustment Engine
   │
   ▼
L5 API 層
  [H] Canonical Cycle API Routes
```

**關鍵依賴說明**：
- A 是新建的第一步（觀察是 cycle 的起點）
- B 擴展已有的 change/judge 模組，加上 canonical proposal lifecycle
- C 和 D 可並行（cycle orchestration + pulse 不互相依賴）
- E 依賴 C，F 依賴 C + E（需要 cycle 跑完才有 outcome/precedent）
- G 依賴 E（需要 outcome 結果才能調整治理）
- H 是 integration layer，把所有模組暴露成 API

## Track Summary

| Track | Name | Layer | Tasks | Dependencies | Status |
|-------|------|-------|-------|-------------|--------|
| A | Observation Builder | L0 | 2 | — | ☐ |
| B | Change Proposal Extensions | L1 | 2 | A | ☐ |
| C | Cycle Runner | L2 | 3 | B | ☐ |
| D | Pulse Emitter | L2 | 2 | A | ☐ |
| E | Outcome Collector | L3 | 3 | C | ☐ |
| F | Precedent Recorder | L3 | 2 | C, E | ☐ |
| G | Governance Adjustment Engine | L4 | 2 | E | ☐ |
| H | Canonical Cycle API Routes | L5 | 3 | All | ☐ |

**Total: 8 Tracks, 19 Tasks**

## Parallel Execution Timeline

```
Batch 1（無依賴）：
  Agent 1 → Track A: A1 → A2

Batch 2（依賴 A，可並行）：
  Agent 1 → Track B: B1 → B2
  Agent 2 → Track D: D1 → D2

Batch 3（依賴 B）：
  Agent 1 → Track C: C1 → C2 → C3

Batch 4（依賴 C）：
  Agent 1 → Track E: E1 → E2 → E3

Batch 5（依賴 E）：
  Agent 1 → Track F: F1 → F2

Batch 6（依賴 E）：
  Agent 1 → Track G: G1 → G2

Batch 7（依賴全部）：
  Agent 1 → Track H: H1 → H2 → H3
```

## Progress Tracking

### Batch 1
- [ ] Track A: Observation Builder
  - [ ] A1: ObservationBatch schema + builder
  - [ ] A2: Observation sources + tests

### Batch 2
- [ ] Track B: Change Proposal Extensions
  - [ ] B1: ChangeProposal lifecycle status machine
  - [ ] B2: ProposalBundle + simulation hooks
- [ ] Track D: Pulse Emitter
  - [ ] D1: PulseFrame builder + metric weights
  - [ ] D2: Pulse SSE + tests

### Batch 3
- [ ] Track C: Cycle Runner
  - [ ] C1: CycleRun schema + state machine
  - [ ] C2: Cycle orchestrator (10 stages)
  - [ ] C3: Cycle cadence + timer + tests

### Batch 4
- [ ] Track E: Outcome Collector
  - [ ] E1: OutcomeWindow schema + lifecycle
  - [ ] E2: Outcome evaluator (metric comparison)
  - [ ] E3: OutcomeReport builder + tests

### Batch 5
- [ ] Track F: Precedent Recorder
  - [ ] F1: PrecedentRecord builder
  - [ ] F2: Edda bridge integration + tests

### Batch 6
- [ ] Track G: Governance Adjustment Engine
  - [ ] G1: GovernanceAdjustment schema + engine
  - [ ] G2: Adjustment routes + tests

### Batch 7
- [ ] Track H: Canonical Cycle API Routes
  - [ ] H1: Cycle management routes (create/list/close)
  - [ ] H2: Observation + proposal + judgment routes
  - [ ] H3: Outcome + precedent + adjustment routes + integration tests

## Module Map

```
src/
  canonical-cycle/
    observation-builder.ts         ← A1: ObservationBatch builder
    observation-sources.ts         ← A2: event/state/external observation sources
    cycle-runner.ts                ← C2: 10-stage cycle orchestrator
    cycle-schema.ts                ← C1: CycleRun Zod schema + state machine
    cycle-cadence.ts               ← C3: timer + interval management
    pulse-emitter.ts               ← D1: PulseFrame builder
    outcome-window.ts              ← E1: OutcomeWindow lifecycle
    outcome-evaluator.ts           ← E2: metric comparison
    outcome-report-builder.ts      ← E3: OutcomeReport construction
    precedent-recorder.ts          ← F1: PrecedentRecord builder
    governance-adjuster.ts         ← G1: GovernanceAdjustment engine
  schemas/
    observation.ts                 ← A1: ObservationBatch schema
    cycle-run.ts                   ← C1: CycleRun schema
    outcome-window.ts              ← E1: OutcomeWindow schema
    governance-adjustment.ts       ← G1: GovernanceAdjustment schema
  routes/
    cycles.ts                      ← H1: cycle management
    observations.ts                ← H2: observation routes
    outcomes.ts                    ← H3: outcome + precedent routes
    adjustments.ts                 ← H3: governance adjustment routes
```

## Canonical Artifact Registry

每個 cycle 產生的 artifacts（見 canonical-cycle.md §5）：

| Artifact | Module | Track |
|----------|--------|-------|
| `observation_batch.json` | observation-builder | A |
| `change_proposal.json` | (existing) + extensions | B |
| `judgment_report.json` | (existing) src/world/judge.ts | — |
| `applied_change.json` | (existing) src/world/change.ts | — |
| `pulse_frame.json` | pulse-emitter | D |
| `outcome_report.json` | outcome-report-builder | E |
| `precedent_record.json` | precedent-recorder | F |
| `governance_adjustment.json` | governance-adjuster | G |
| `world_snapshot.json` | (existing) src/world/snapshot.ts | — |
