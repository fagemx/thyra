# container-routing-v0.md

> Status: `working draft`
>
> Purpose: Define how Völva selects which **work container** to route a request into — and how containers can transition during a session.
>
> This file does NOT cover:
> - What a skill object looks like internally (see `skill-object-v0.md`)
> - How skills evolve over time (see `skill-lifecycle-v0.md`)
> - The user-facing interaction model (see `volva-interaction-model-v0.md`)

---

## 1. One-Liner

> **Container selection is not a classifier. It's a routing protocol based on work state, capability inventory, risk, and user posture.**

---

## 2. What It's NOT

### Not a text classifier
Classifying "deploy checkout-service" into a label always fails because the same sentence can mean Skill, Task, Review, or Harvest depending on context.

### Not a static menu of 6 options shown to the user
The 6 containers are internal routing targets. Users see 4 postures (see `volva-interaction-model-v0.md`).

### Not a one-shot decision
Many requests are container sequences (Shape → World → Harvest), not single labels. Selection picks a **primary container** and allows transitions.

---

## 3. Six Internal Containers

| Container | Purpose | When |
|-----------|---------|------|
| **World** | Persistent work environment with shared state, roles, history | Long-term domains, ongoing projects |
| **Shape** | Problem not yet formed — route, decompose, find regime, probe path | Fuzzy intent, path unclear |
| **Skill** | Mature reusable method package | Known problem class with existing capability |
| **Task** | One-off bounded work with clear deliverable | Clear scope, not worth skill-izing |
| **Review** | Evidence-first investigation — diagnose, audit, compare | Need to inspect before acting |
| **Harvest** | Extract reusable pattern from completed work | After work is done, method worth capturing |

---

## 4. Routing Protocol

Not a classifier. A **sequential gate check**:

```text
1. Is this clearly a long-term domain / persistent world?
   YES → World

2. Is the path unclear / problem not yet formed?
   YES → Shape

3. Is the primary posture inspect / judge / diagnose?
   YES → Review

4. Does a mature skill exist for this problem class?
   YES → Skill

5. Is this a bounded one-off job with clear deliverable?
   YES → Task

6. After completion: does the work pattern have reuse value?
   YES → Harvest
```

### Four Routing Axes

Each request is evaluated on 4 axes, not classified into a label:

| Axis | Low | High |
|------|-----|------|
| **Persistence** | one-off → Task | long-term → World |
| **Path clarity** | fuzzy → Shape | clear → Skill/Task |
| **Method maturity** | ad hoc → Task/Shape | mature → Skill |
| **Primary posture** | act → Skill/Task | inspect → Review | harvest → Harvest |

### Primary + Secondary Container

Selection outputs a primary and optional secondary:

```ts
type ContainerSelection = {
  primary: "world" | "shape" | "skill" | "task" | "review" | "harvest";
  secondary?: "world" | "shape" | "skill" | "task" | "review" | "harvest";
  confidence: "low" | "medium" | "high";
  rationale: string;
};
```

Example: "Deploy checkout-service, then capture the flow as a skill"
→ primary: `skill`, secondary: `harvest`

---

## 5. Container Transitions

Containers are not locked for a session. Transitions are allowed:

```text
Shape → Skill     (path becomes clear, matching skill found)
Shape → World     (problem requires persistent environment)
Task  → Harvest   (one-off work reveals reusable pattern)
Skill → Review    (skill run hits anomaly, needs investigation)
Review → Skill    (investigation reveals known problem, skill exists)
Any   → Harvest   (after completion, if method has reuse value)
```

---

## 6. Default Fallbacks

When routing is ambiguous, use these defaults:

| Signal | Default |
|--------|---------|
| Don't know how to handle | **Shape** |
| Know what to deliver | **Task** |
| Matching skill exists | **Skill** |
| Want to build long-term | **World** |
| Need to look before acting | **Review** |
| Just finished, want to capture | **Harvest** |

---

## 7. Canonical Examples

### Example A: "Deploy checkout-service to staging"

Axes:
- Persistence: low
- Path clarity: high
- Method maturity: high (deploy skill exists)
- Posture: act

→ **Skill** (deploy-service skill)

### Example B: "I have a product direction but don't know how to approach it"

Axes:
- Persistence: uncertain
- Path clarity: low
- Method maturity: low
- Posture: explore

→ **Shape** (intent-router → space-builder → probe)

### Example C: "Why did the last deploy fail?"

Axes:
- Persistence: low
- Path clarity: high (know what to investigate)
- Method maturity: medium
- Posture: inspect

→ **Review**

---

## 8. Boundaries / Out of Scope

- This spec defines **internal container routing**. The user-facing language (4 postures) is in `volva-interaction-model-v0.md`.
- This spec does NOT define what happens inside each container — only how the system decides which one to enter.
- Harvest is always **post-hoc** — it never pre-empts other containers.

---

## Closing Line

> **Container selection is not "what kind of request is this?" — it's "given this work state, capability inventory, and user posture, which container should this request enter first?"**
