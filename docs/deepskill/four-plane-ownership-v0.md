# four-plane-ownership-v0.md

> Status: `working draft`
>
> Purpose: Define which plane (Völva / Karvi / Thyra / Edda) owns which fields of the skill object — preventing multi-truth-source chaos.
>
> Core rule: **Every field has exactly one canonical owner. Others can read, propose, or record — but not overwrite.**

---

## 1. One-Liner

> **A skill is a federated object: Völva defines its meaning, Karvi defines its dispatch, Thyra defines its runtime, Edda defines its history.**

---

## 2. What It's NOT

### Not four copies of the same object
Each plane holds only its slice. Not replicated, not mirrored.

### Not a single repo monolith
Putting everything in one repo mixes meaning, dispatch, and runtime. They'll drift.

### Not optional
Without clear ownership, you get: trigger changed but dispatch doesn't know, permissions changed but skill def didn't reflect, gotcha confirmed but not written back.

---

## 3. Four Planes

| Plane | Owns | Source of truth for |
|-------|------|-------------------|
| **Völva** | Core definition | What this skill IS, when to trigger, what's in the package |
| **Karvi** | Dispatch overlay | How to send to workers, which repo/runtime, retry/timeout |
| **Thyra** | Runtime overlay | Permissions, guardrails, verification, judgment, outcome schema |
| **Edda** | History/precedent | What happened, what worked, what failed, supersession chain |

---

## 4. Ownership Map

### A. Identity / Meaning — **Völva owns**

| Field | Owner | Others |
|-------|-------|--------|
| `id`, `name`, `version` | Völva | all read |
| `summary`, `domain`, `tags` | Völva | all read |
| `owners.human`, `owners.agent` | Völva | Edda records transfers |
| `status`, `maturity`, `riskTier` | Völva | Edda records changes |

### B. Purpose / Routing — **Völva owns**

| Field | Owner | Others |
|-------|-------|--------|
| `purpose.problemShapes` | Völva | Karvi/Thyra read |
| `purpose.desiredOutcomes` | Völva | Thyra reads for verification |
| `purpose.nonGoals`, `notFor` | Völva | all read; Thyra/Karvi may propose additions |
| `routing.triggerWhen` | Völva | all read; Thyra/Karvi may propose |
| `routing.doNotTriggerWhen` | Völva | all read; Edda may surface false-trigger precedent |
| `routing.conflictsWith`, `mayChainTo` | Völva | Karvi may propose |

### C. Contract / Package — **Völva owns**

| Field | Owner | Others |
|-------|-------|--------|
| `contract.inputs`, `outputs` | Völva | Karvi/Thyra read |
| `contract.successCriteria` | Völva | Thyra reads for verification |
| `contract.failureModes` | Völva | Edda may propose new ones from precedent |
| `package.*` (root, refs, scripts, assets) | Völva | all read |
| `gotchas` (current text) | Völva | Edda owns the confirmation history |

### D. Dispatch — **Karvi owns**

| Field | Owner | Others |
|-------|-------|--------|
| `dispatch.mode` | Karvi | all read |
| `dispatch.targetSelection.*` | Karvi | Thyra may constrain |
| `dispatch.workerClass` | Karvi | all read |
| `dispatch.handoff.*` | Karvi | Völva/Thyra may propose |
| `dispatch.executionPolicy.*` | Karvi | all read |
| `dispatch.approval.*` | Karvi | Thyra may require stricter gates |

### E. Runtime / Governance — **Thyra owns**

| Field | Owner | Others |
|-------|-------|--------|
| `environment.toolsRequired/Optional` | Thyra | Völva may propose |
| `environment.permissions` | Thyra | **always Edda-recorded** |
| `environment.externalSideEffects` | Thyra | **always Edda-recorded** |
| `environment.executionMode` | Thyra | all read |
| `verification.smokeChecks`, `assertions` | Thyra | Völva may propose |
| `verification.humanCheckpoints` | Thyra | **always Edda-recorded** |
| `verification.outcomeSignals` | Thyra | Edda reads for precedent |
| `governance.mutability.*` | Thyra | all read |

### F. History / Precedent — **Edda owns**

| Field | Owner | Others |
|-------|-------|--------|
| Promotion history | Edda | all read |
| `supersedes`, `supersededBy` | Edda | Völva mirrors current reference |
| Confirmed gotchas (history/evidence) | Edda | Völva owns current active text |
| Run outcomes | Edda | Thyra provides source events |
| False-trigger records | Edda | Völva reads to update routing |

---

## 5. Three Cardinal Rules

### Rule 1: Völva does not decide dispatch truth
It can say "this skill is probably suited for review workers" — but the actual dispatch config (repo, runtime, retry, timeout) belongs to Karvi.

### Rule 2: Völva does not decide runtime truth
It can say "this skill should be advisory" — but the actual permissions, guardrails, verification, and judgment rules belong to Thyra.

### Rule 3: Edda does not become a config store
Edda records what happened. It does NOT become the current configuration source. Current truth stays in Völva/Karvi/Thyra.

---

## 6. File Layout

```text
Völva repo:
  skills/<skill-id>/
    skill.object.yaml       ← canonical core
    SKILL.md
    references/
    scripts/
    assets/

Karvi repo:
  bindings/skills/<skill-id>.dispatch.yaml    ← dispatch overlay

Thyra repo:
  bindings/skills/<skill-id>.runtime.yaml     ← runtime overlay

Edda:
  events (append-only):
    skill.created
    skill.patched
    skill.gotcha.confirmed
    skill.promoted
    skill.dispatched
    skill.run.succeeded
    skill.run.failed
    skill.rollback
    skill.superseded
```

---

## 7. Canonical Example: `arch-spec`

```text
Völva holds:
  id: skill.arch-spec
  purpose: architecture crystallization
  routing: trigger when fuzzy concept needs spec stack
  package: SKILL.md + references/ + examples/

Karvi holds:
  dispatch.mode: hybrid
  workerClass: [review, research]
  runtimeOptions: [codex, opencode]
  timeoutMinutes: 20

Thyra holds:
  executionMode: assistive
  externalSideEffects: false
  smokeChecks: [has-boundaries, has-non-goals]
  humanCheckpoints: [boundary-review, promotion-decision]
  guardrails: [do-not-collapse-into-task-list]

Edda records:
  skill.created (from recurring conversation pattern)
  skill.gotcha.confirmed ("agent tends to default to full stack")
  skill.run.succeeded (world-design-v0)
  skill.run.succeeded (storage stack)
```

---

## 8. Boundaries / Out of Scope

- This spec defines **field ownership**. The field definitions themselves are in `skill-object-v0.md`.
- v0 recommends a **"one main + three side" model**: main file in Völva, minimal overlays in Karvi/Thyra, events in Edda. Don't over-split in v0.

---

## Closing Line

> **Every field has one owner. If two planes both think they own a field, you have a drift bug waiting to happen.**
