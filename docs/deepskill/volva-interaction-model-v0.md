# volva-interaction-model-v0.md

> Status: `working draft`
>
> Purpose: Define what Völva's user-facing interaction looks like — the **front stage** that hides the complexity of containers, dispatch, and governance.
>
> This file does NOT cover:
> - Internal container routing logic (see `container-routing-v0.md`)
> - Skill object structure (see `skill-object-v0.md`)

---

## 1. One-Liner

> **Völva's front stage is a single continuous agent. The back stage is a routable, dispatchable, governable work system.**

---

## 2. What It's NOT

### Not a multi-agent chat UI
Users don't see 8 agents competing. They see ONE main agent that understands, routes, translates, and reports.

### Not a feature menu
Users don't pick "Village Pack" or "intent-router" or "Skill container." Those are internal. Users pick **postures**.

### Not just a chatbot
The main agent is not only conversational. It's a **steward** that understands work state, selects containers, dispatches to back-stage workers, and brings results back in human language.

---

## 3. Three Planes

```text
┌─────────────────────────┐
│   Conversation Plane    │ ← user talks to ONE main agent
│   (front stage)         │
└───────────┬─────────────┘
            │
┌───────────▼─────────────┐
│   Execution Plane       │ ← skills, tasks, workers, dispatch, runtime
│   (back stage)          │
└───────────┬─────────────┘
            │
┌───────────▼─────────────┐
│   Control Plane         │ ← monitor, pause, cancel, approve, reroute
│   (side stage)          │
└─────────────────────────┘
```

### Conversation Plane
What the user interacts with:
- Receive requests
- Understand intent
- Select work posture
- Report milestones
- Translate results to human language

### Execution Plane
What actually does the work:
- Skills, tasks, review workers
- Karvi dispatch
- Thyra runtime constraints
- Edda precedent recording

### Control Plane
How the user (or system) intervenes:
- View progress
- Pause / resume
- Cancel
- Approve next step
- Reroute

Control signals are NOT chat messages — they're structured control operations. But the user CAN trigger them via the main agent ("show me progress", "stop that").

---

## 4. Four User Postures

Users don't see 6 containers. They see 4 postures:

| Posture | User says | Back-stage container |
|---------|-----------|---------------------|
| **Open a world** | "Start a long-term project" / "Build me a workspace" | World |
| **Help me think** | "I have a direction but don't know how" / "Don't rush to tasks" | Shape / Review |
| **Just do it** | "Deploy this" / "Fix that" / "Run this review" | Skill / Task |
| **Capture this method** | "That workflow was good, save it" / "Make this reusable" | Harvest |

### Mapping

```text
Open a world    → World container
Help me think   → Shape container (+ sometimes Review)
Just do it      → Skill container (if skill exists) / Task container (if not)
Capture method  → Harvest container
```

---

## 5. Four Interaction Modes

| Mode | What's happening | User experience |
|------|-----------------|-----------------|
| **Chat** | Discussing, exploring, clarifying | Main agent listens, asks, suggests posture |
| **Work** | Container activated, back-stage running | Main agent reports: "Started X, next step Y, need your approval for Z" |
| **Watch** | User wants progress, not conversation | Timeline / board / status view (not chat bubbles) |
| **Control** | User intervenes | Pause, cancel, approve, reroute — structured signals |

---

## 6. Main Agent Is Not an Orchestrator

The main agent is a **steward / editor / liaison**, not a task dispatcher:

| Steward does | Orchestrator does (NOT this) |
|-------------|------------------------------|
| Understands what you're really trying to do | Blindly routes to the right function |
| Maintains conversational continuity | Drops context between dispatch calls |
| Translates back-stage results to human language | Dumps raw logs |
| Helps you switch between explore / execute / harvest | Forces you to pick a mode upfront |
| Knows when to ask vs when to just proceed | Always asks or never asks |

---

## 7. Canonical Examples

### Example A: Explore → Execute → Harvest journey

```text
User: "I want to make money with video generation"

[Chat mode]
Main agent: routes to Shape container (intent = economic, path unclear)
→ path-check: medium certainty
→ space-builder generates candidates

[Work mode]
Main agent: "I've identified 3 candidates. The strongest is workflow-install service."
→ probe-commit: DM 10 studios, landing page test
→ signal: 3 replies, 1 willing to talk pricing

[Chat mode]
Main agent: "Buyer signal exists. Ready to commit to Forge?"
User: "Yes"

[Work mode]
→ Forge builds: intake flow, install checklist, case showcase

[Harvest]
Main agent: "This workflow worked well. Want me to capture it as a reusable skill?"
User: "Yes"
→ Harvest: crystallize into skill.workflow-install-service
```

### Example B: Control intervention

```text
[Work mode — deploy running]
Main agent: "Staging deploy complete. Smoke tests: 18/18 pass. Requesting prod approval."

User: "Wait, I saw latency spike in the dashboard. Hold off."

[Control mode]
→ Pause signal sent to Karvi dispatch
→ Main agent: "Prod rollout paused. Want me to investigate the latency spike?"

User: "Yes"
→ Container transition: Skill (deploy) → Review (investigation)
```

---

## 8. Boundaries / Out of Scope

- This spec defines the **user-facing model**. Internal routing logic is in `container-routing-v0.md`.
- This spec does NOT define the Workboard / Control Panel UI. That's a future product spec.
- This spec does NOT define how the main agent selects containers. That's the routing protocol.
- v1 scope: 1 main agent, 4 containers (World, Shape, Skill, Task). Review and Harvest can start semi-manual.

---

## Closing Line

> **Users should feel like they're working with one intelligent steward. Behind the scenes, that steward is routing to containers, dispatching to workers, enforcing governance, and accumulating precedent — but the user only sees: "I said what I wanted, and it's being handled."**
