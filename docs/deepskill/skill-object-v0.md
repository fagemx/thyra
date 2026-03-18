# skill-object-v0.md

> Status: `working draft`
>
> Purpose: Define what a **governable skill object** is — its structure, fields, and the contract between capability, governance, dispatch, and runtime.
>
> This file does NOT cover:
> - How skills are routed/selected (see `container-routing-v0.md`)
> - How skills evolve over time (see `skill-lifecycle-v0.md`)
> - Which plane owns which field (see `four-plane-ownership-v0.md`)

---

## 1. One-Liner

> **A skill is not an instruction. A skill is an agent-loadable, explorable, executable, experience-accumulating, governable local work environment.**

---

## 2. What It's NOT

### Not a prompt wrapper
A prompt tells the model what to say. A skill defines a **work environment** the model enters — with tools, references, gotchas, verification, and governance.

### Not a static playbook
A playbook is read-once documentation. A skill has a lifecycle: it's patched, tested, promoted, versioned, and sometimes retired.

### Not a generic tool call
A tool does one thing. A skill bundles judgment, method, tooling, verification, and memory into a coherent capability unit.

### Not a universal container
Not everything should be a skill. One-off tasks, brainstorms, and unstable concepts should NOT be skill-ized. Only patterns that are **repeating, bounded, and worth governing** become skills.

---

## 3. Core Definition

A governable skill object is split into three layers:

### Skill Package (the files)
What the agent actually reads and runs:
- `SKILL.md` — entry instructions
- `references/` — progressive disclosure docs
- `scripts/` — executable helpers
- `assets/` — templates, examples
- `config.json` — settings
- local state — drafts, logs, gotcha candidates

### Skill Object (the contract)
The governance and routing envelope around the package:
- When to trigger, when not to
- What it can and cannot do
- How it's verified
- Who can change what
- Promotion status

### Skill Run (the instance)
Each actual execution:
- Why it was triggered
- Which version was used
- What steps were taken
- Success/failure
- Gotcha candidates discovered

---

## 4. Canonical Schema

```yaml
kind: SkillObject
apiVersion: volva.ai/v0

id: skill.<name>
name: <name>
version: 0.1.0
status: draft  # draft | sandbox | promoted | core | deprecated

identity:
  summary: <one sentence — what this skill does>
  owners:
    human: [<owner>]
    agent: [<agent>]
  domain: <domain>
  tags: [<tags>]
  maturity: emerging  # emerging | stable | core
  riskTier: low  # low | medium | high | critical

purpose:
  problemShapes: []      # what kinds of problems this handles
  desiredOutcomes: []    # what good output looks like
  nonGoals: []           # what this skill explicitly does NOT do
  notFor: []             # what situations should NOT trigger this

routing:
  description: <trigger description — not a summary, but when-to-use>
  triggerWhen: []
  doNotTriggerWhen: []
  priority: 50
  conflictsWith: []
  mayChainTo: []

contract:
  inputs:
    required: []
    optional: []
  outputs:
    primary: []
    secondary: []
  successCriteria: []
  failureModes: []

package:
  root: <path>
  entryFile: SKILL.md
  references: []
  scripts: []
  assets: []
  config:
    schemaFile: config.schema.json
    dataFile: config.json
  hooks: []
  localState:
    enabled: true
    stablePath: ${SKILL_DATA}/<name>/
    files: []

environment:
  toolsRequired: []
  toolsOptional: []
  permissions:
    filesystem: { read: true, write: false }
    network: { read: false, write: false }
  externalSideEffects: false
  executionMode: advisory  # advisory | assistive | active | destructive

dispatch:
  mode: local  # local | karvi | hybrid
  targetSelection:
    repoPolicy: explicit
    runtimeOptions: []
  workerClass: []
  handoff:
    inputArtifacts: []
    outputArtifacts: []
  executionPolicy:
    sync: false
    retries: 1
    timeoutMinutes: 30
    escalationOnFailure: true
  approval:
    requireHumanBeforeDispatch: false
    requireHumanBeforeMerge: true

verification:
  smokeChecks: []
  assertions: []
  humanCheckpoints: []
  outcomeSignals: []

memory:
  localMemoryPolicy:
    canStore: []
    cannotStore: [secrets, unrelated-user-data]
  precedentWriteback:
    enabled: true
    target: edda
    when: []

governance:
  mutability:
    agentMayEdit: []
    agentMayPropose: []
    humanApprovalRequired: []
    forbiddenWithoutHuman: []
  reviewPolicy:
    requiredReviewers: [owner]
  promotionGates: []
  rollbackPolicy:
    allowed: true
    rollbackOn: []
  supersession:
    supersedes: []
    supersededBy: null

telemetry:
  track: []
  thresholds: {}
  reporting: {}

lifecycle:
  createdFrom: []
  currentStage: draft
  promotionPath: [draft, sandbox, promoted, core]
  retirementCriteria: []
  lastReviewedAt: null
```

---

## 5. Ten Required Sections

Every skill object must have at minimum these 10 sections. Without any of them, the skill is incomplete:

| Section | What it answers |
|---------|----------------|
| `identity` | What is this, who owns it, how mature, how risky |
| `purpose` | What problems, what outcomes, what NOT |
| `routing` | When to trigger, when NOT to trigger |
| `contract` | What goes in, what comes out, what's success |
| `package` | Where are the files, scripts, templates, config |
| `environment` | What tools, permissions, side effects, execution mode |
| `dispatch` | How to send to other workers/runtimes (Karvi) |
| `verification` | How to know it worked |
| `memory` | What to remember, what to send to Edda |
| `governance` | Who can change what, how to promote/rollback |

---

## 6. Position in the Overall System

```text
Völva (crystallize)
  ↓ defines skill identity, purpose, routing, contract, package
Karvi (dispatch)
  ↓ defines how skill becomes org-level work
Thyra (runtime)
  ↓ defines how skill runs in governed world
Edda (memory)
  ↓ records what happened, what worked, what failed
```

The skill object is a **federated object**: one logical entity, four planes each owning their slice.

---

## 7. Canonical Examples

### Example A: `arch-spec` skill

```yaml
id: skill.arch-spec
status: sandbox
purpose:
  problemShapes: [ambiguous-intent, architecture-crystallization]
  desiredOutcomes: [reviewable-spec-stack]
  notFor: [direct-implementation, production-ops]
routing:
  triggerWhen:
    - user has fuzzy concept needing architecture structure
    - project-plan is premature
  doNotTriggerWhen:
    - task is already implementation-ready
environment:
  externalSideEffects: false
  executionMode: assistive
dispatch:
  mode: local
verification:
  smokeChecks: [has-boundaries, has-non-goals, has-promotion-check]
  humanCheckpoints: [boundary-review, promotion-decision]
```

### Example B: `deploy-service` skill

```yaml
id: skill.deploy-service
status: promoted
purpose:
  problemShapes: [service-deploy, staged-release, rollback-aware-rollout]
  notFor: [hotfix-authoring, incident-investigation, schema-redesign]
routing:
  triggerWhen:
    - user requests deploy of specific service
    - deploy artifact/commit/tag exists
  doNotTriggerWhen:
    - build not yet complete
    - only debugging a bug
environment:
  externalSideEffects: true
  executionMode: active
dispatch:
  mode: karvi
  workerClass: [implementation, verification, ops]
  approval:
    requireHumanBeforeDispatch: false
    requireHumanBeforeMerge: true
verification:
  smokeChecks: [staging-smoke-pass, error-rate-within-threshold]
  humanCheckpoints: [prod-rollout-approval]
governance:
  mutability:
    forbiddenWithoutHuman: [enabling-destructive-actions, broadening-side-effects]
```

---

## 8. Boundaries / Out of Scope

- This spec does NOT define the skill lifecycle (capture → crystallize → promote → retire). See `skill-lifecycle-v0.md`.
- This spec does NOT define which plane owns which field. See `four-plane-ownership-v0.md`.
- This spec does NOT define how skills are selected/routed at runtime. See `container-routing-v0.md`.
- This spec does NOT define Völva's user-facing interaction model. See `volva-interaction-model-v0.md`.

---

## Closing Line

> **A skill is not what you tell an agent to do. It's a governed, explorable, verifiable work environment that an agent enters — and that gets better every time it's used.**
