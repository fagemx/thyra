# World Governance Cycle — Architecture Constraints

> These rules cannot be violated during development.
> Any task that violates these rules is considered incomplete.
> Derived from `docs/world-design-v0/` spec stack + Thyra CLAUDE.md.

## Rules

| Rule ID | Description | Verification | Affected Tracks |
|---------|------------|--------------|-----------------|
| CYCLE-01 | Cycle stages execute in fixed order: observe → propose → judge → apply → pulse → outcome → precedent → adjust | Code review: cycle-runner enforces stage ordering | C |
| CYCLE-02 | Every cycle produces a CycleRun artifact with all stage timestamps | `bun test src/canonical-cycle/cycle-runner.test.ts` | C |
| CYCLE-03 | Cycle cadence is configurable (default 15min) but never skippable | Config test: cadence 0 is rejected | C |
| JUDGE-01 | Judgment uses 4-layer stack: structural → invariants → constitution → contextual | Code review: judge always runs all 4 layers | B |
| JUDGE-02 | Verdict must be one of 6 values from shared-types.md §6.3 | Zod schema validation | B |
| PULSE-01 | PulseFrame must include healthScore, mode, stability, dominantConcerns | Zod `.safeParse()` on PulseFrame | D |
| PULSE-02 | Pulse is emitted after every apply, not just on schedule | Code review: apply → pulse emission | C, D |
| OUTCOME-01 | OutcomeWindow has explicit open/close lifecycle, not implicit timeout | State machine test | E |
| OUTCOME-02 | OutcomeReport compares baseline vs observed metrics with delta | OutcomeReport schema test | E |
| PREC-01 | PrecedentRecord must link to proposalId + outcomeReportId via SourceRef | Schema validation | F |
| PREC-02 | Precedent is append-only — no modify, no delete | Code review: no UPDATE/DELETE on precedent table | F |
| ADJ-01 | GovernanceAdjustment must specify target (law/chief/policy) + before/after | Schema validation | G |
| ADJ-02 | Adjustment only fires when outcome verdict is harmful or recommendation is rollback/retune | Code review: adjustment trigger conditions | G |
| API-01 | All canonical cycle routes follow THY-11 envelope: `{ ok, data/error }` | Route tests | H |
| API-02 | Route paths match world-cycle-api.md exactly | Route path comparison test | H |
| THY-01 | TypeScript `strict: true`, no `any`, no `!` assertions | `bun run build` zero errors | All |
| THY-04 | All entities have `id`, `created_at`, `version` | Schema review | All |
| THY-07 | All state changes write audit_log (append-only) | Code review | All |
| THY-11 | API response: `{ ok: true, data }` or `{ ok: false, error: { code, message } }` | Route tests | H |
| THY-12 | Safety Invariants hardcoded, never overridable | Code review | B |

---

## Detailed Rules

### CYCLE-01: Fixed Stage Order

**Description**: The canonical cycle runs 10 stages in strict order. No stage can be skipped or reordered. The cycle-runner enforces this via a state machine.

**Rationale**: Governance without order is chaos. Skipping judgment means unchecked changes; skipping outcome means no learning.

**Verification**: Cycle-runner state machine test: attempting to call `apply` before `judge` throws error.

**Consequence of violation**: World changes happen without judgment; outcomes are never measured; governance degrades to task execution.

---

### OUTCOME-01: Explicit Outcome Window Lifecycle

**Description**: An OutcomeWindow is explicitly opened when a change is applied and explicitly closed when metrics are evaluated. It is NOT a passive timer that auto-closes.

**Rationale**: Auto-closing encourages ignoring outcomes. Explicit close forces evaluation.

**Verification**:
```bash
bun test src/canonical-cycle/outcome-window.test.ts
# open → evaluating → closed lifecycle
# Cannot skip from open to closed without evaluation
```

**Consequence of violation**: Outcomes become decorative; the system stops learning from its changes.

---

### PREC-01: Precedent Traceability

**Description**: Every PrecedentRecord must include `proposalId` and `outcomeReportId` so the full chain (proposal → judgment → change → outcome → precedent) is traceable.

**Rationale**: A precedent without traceability is an opinion, not evidence.

**Verification**:
```bash
bun test src/canonical-cycle/precedent-recorder.test.ts
# PrecedentRecord without proposalId → rejected
# PrecedentRecord without outcomeReportId → rejected
```

**Consequence of violation**: Edda gets unanchored precedents that can't be verified against real outcomes.
