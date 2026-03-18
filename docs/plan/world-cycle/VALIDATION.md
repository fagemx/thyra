# World Governance Cycle — Validation Plan

## Track Acceptance Criteria

### Track A: Observation Builder

| Item | Pass Criteria | Verification |
|------|--------------|-------------|
| Build | `bun run build` zero errors | `bun run build 2>&1` |
| Schema | ObservationBatch validates with Zod | Schema tests |
| Sources | Aggregates from state diff + audit log + external | Builder tests |

### Track B: Change Proposal Extensions

| Item | Pass Criteria | Verification |
|------|--------------|-------------|
| Lifecycle | State machine enforces valid transitions | `bun test src/canonical-cycle/` |
| Judgment | 4-layer stack runs in order | Judge tests |
| Verdict | All 6 values accepted, invalid rejected | Schema tests |
| Bundle | ProposalBundle groups proposals | Bundle tests |

### Track C: Cycle Runner

| Item | Pass Criteria | Verification |
|------|--------------|-------------|
| Stages | 10 stages in fixed order | `bun test src/canonical-cycle/cycle-runner.test.ts` |
| Artifact | CycleRun has all stage timestamps | Schema tests |
| Cadence | Configurable interval, 0 rejected | Config tests |

### Track D: Pulse Emitter

| Item | Pass Criteria | Verification |
|------|--------------|-------------|
| PulseFrame | healthScore + mode + stability + concerns | Schema tests |
| Emission | Fires after every apply | Integration test |
| Weights | Mode-aware metric weighting | Weight tests |

### Track E: Outcome Collector

| Item | Pass Criteria | Verification |
|------|--------------|-------------|
| Window | Explicit open → evaluating → closed lifecycle | State machine test |
| Report | Baseline vs observed with delta | Evaluator tests |
| Verdict | 4 outcomes: beneficial/neutral/harmful/inconclusive | Schema tests |
| SideEffects | Severity: negligible/minor/significant | Schema tests |

### Track F: Precedent Recorder

| Item | Pass Criteria | Verification |
|------|--------------|-------------|
| Linking | proposalId + outcomeReportId required | Schema test |
| Append-only | No UPDATE/DELETE | Code review |
| Edda bridge | Fire-and-forget writeback | Bridge test |

### Track G: Governance Adjustment Engine

| Item | Pass Criteria | Verification |
|------|--------------|-------------|
| Trigger | Fires on harmful/rollback/retune only | Trigger tests |
| Schema | target + before/after + adjustmentType | Schema test |

### Track H: Canonical Cycle API Routes

| Item | Pass Criteria | Verification |
|------|--------------|-------------|
| Paths | Match world-cycle-api.md exactly | Path comparison test |
| Envelope | All routes use THY-11 | Route tests |
| Integration | Full 10-stage cycle via API | E2E test |

---

## Golden Path Scenarios

### GP-1: Minimum Cycle Closure (Track A + B + C)

**Description**: One complete governance cycle from observation to next cycle, using Midnight Market.

**Steps**:
1. Create world (Midnight Market, 2 zones, 3 chiefs)
2. Start cycle → observation builder aggregates state
3. Chief proposes `throttle_entry` on north_gate
4. Judge: 4-layer stack → approved_with_constraints (60min)
5. Apply change → north_gate throttle enabled
6. Cycle advances to next stage

**Verification**: CycleRun artifact has timestamps for observe/propose/judge/apply. World state reflects the throttle change.

---

### GP-2: Pulse After Change (Track A + B + C + D)

**Description**: After applying a change, pulse reflects updated world health.

**Steps**:
1. Complete GP-1 (change applied)
2. Pulse emitter fires
3. PulseFrame shows: congestion_score decreased, mode=peak, stability=stable
4. dominantConcerns includes previous congestion concern as resolved

**Verification**: PulseFrame has valid healthScore, correct mode, dominantConcerns array populated.

---

### GP-3: Outcome Learning Loop (Track A + B + C + D + E + F)

**Description**: Full outcome → precedent chain proving the system learns from changes.

**Steps**:
1. Complete GP-2 (change applied + pulse emitted)
2. OutcomeWindow opens for the throttle change
3. Wait observation period (or simulate)
4. Outcome evaluator compares: congestion baseline=72 vs observed=45
5. OutcomeReport: verdict=beneficial, recommendation=reinforce
6. PrecedentRecord created: "throttle_entry on congested gate → congestion -37%"
7. Precedent sent to Edda via bridge

**Verification**: OutcomeReport has metric deltas. PrecedentRecord links to proposal + outcome. Edda bridge called.

---

### GP-4: Governance Adjustment (Track E + G)

**Description**: Harmful outcome triggers governance adjustment.

**Steps**:
1. Apply a `modify_pricing_rule` change → spotlightPremium doubled
2. OutcomeWindow opens
3. Outcome: fairness_score dropped from 0.85 to 0.52
4. OutcomeReport: verdict=harmful, recommendation=retune
5. GovernanceAdjustment: adjustmentType=law_threshold, target=pricing_fairness_gate, before=0.5, after=0.7
6. Adjustment proposed for next cycle's judgment

**Verification**: GovernanceAdjustment fires only because verdict=harmful. Adjustment specifies target + before/after.

---

### GP-5: Full Canonical Demo (All Tracks)

**Description**: The 6-minute demo from `midnight-market-demo-path.md` — complete API walkthrough.

**Steps**:
1. `POST /api/v1/worlds` → create Midnight Market
2. `POST /api/v1/worlds/:id/cycles` → start first cycle
3. `GET /api/v1/cycles/:id/observations` → see observation batch
4. `POST /api/v1/cycles/:id/proposals` → chief proposes throttle
5. `POST /api/v1/proposals/:id/judgment` → 4-layer judgment
6. `POST /api/v1/proposals/:id/apply` → apply change
7. `GET /api/v1/worlds/:id/pulse` → see updated PulseFrame
8. `POST /api/v1/outcome-windows/:id/evaluate` → evaluate outcome
9. `GET /api/v1/worlds/:id/precedents` → see PrecedentRecord
10. `POST /api/v1/worlds/:id/governance-adjustments` → if needed

**Verification**: All 10 canonical cycle stages have been exercised via API. World state evolved. Pulse visible. Outcome recorded. Precedent exists.

---

## Quality Benchmarks

| CONTRACT Rule | Metric | Baseline | Verification |
|--------------|--------|----------|-------------|
| CYCLE-01 | Stage order enforced | 100% | Cycle-runner state machine tests |
| JUDGE-01 | 4-layer stack runs in order | 100% | Judge test |
| PULSE-01 | PulseFrame complete | All 4 fields present | Schema test |
| OUTCOME-01 | Explicit lifecycle | No auto-close | State machine test |
| PREC-01 | Traceability | proposalId + outcomeReportId always present | Schema test |
| ADJ-02 | Only fires on harmful/retune/rollback | No false triggers | Trigger test |
| API-02 | Routes match spec | 100% path match | Path comparison |
| THY-01 | TypeScript strict | Zero tsc errors | `bun run build` |
| THY-11 | API envelope | All routes wrapped | Route tests |
