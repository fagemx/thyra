# skill-lifecycle-v0.md

> Status: `working draft`
>
> Purpose: Define how a skill goes from first encounter to mature capability — the 8 stages from capture to retirement.
>
> This file does NOT cover:
> - The skill object schema (see `skill-object-v0.md`)
> - Which plane owns which lifecycle field (see `four-plane-ownership-v0.md`)

---

## 1. One-Liner

> **Skills are not created upfront. They crystallize from real work, get tested against reality, and evolve through governed promotion.**

---

## 2. What It's NOT

### Not "design a skill, then use it"
Most valuable skills emerge FROM work, not before it. You encounter a problem, handle it, notice the pattern, then crystallize.

### Not "create once, use forever"
Skills have versions, patches, gotchas that grow over time, and eventually get retired or superseded.

### Not "every problem needs a skill"
Only patterns that are **repeating, bounded, and worth governing** should become skills. One-off tasks and unstable concepts should NOT be skill-ized.

---

## 3. Eight Lifecycle Stages

```text
1. CAPTURE     → notice a repeating pattern from real work
2. CRYSTALLIZE → compress it into a skill candidate
3. PACKAGE     → add structure: instructions, gotchas, scripts, config, refs
4. ROUTE       → define trigger semantics and boundaries
5. EXECUTE     → agent uses it on real work
6. VERIFY      → check output, outcomes, side effects
7. LEARN       → new gotchas, patches, memory updates
8. GOVERN      → promote, merge, restrict, retire
```

---

## 4. When to Skill-ize vs. When Not To

| Situation | Action |
|-----------|--------|
| Low risk, one-off, clear scope | **Don't skill-ize.** Just do it (Task container). |
| Medium risk, might repeat, some pattern | **Skill candidate.** Minimal skeleton, keep in sandbox. |
| High risk, will repeat, needs governance | **Skill required.** Build skeleton before first execution. |
| After 3+ runs with consistent pattern | **Crystallize.** It's proven — formalize it. |

### Key principle

> High-risk tasks (deploy, prod ops, maintenance) should have at least a **minimal skill skeleton** before first execution — because the cost of unstructured failure is too high.

---

## 5. Stage Details

### Stage 1: Capture
- Source: recurring conversation, repeated workflow, identified pattern
- Output: a note or observation that "this keeps coming up"
- NOT a skill yet — just recognition

### Stage 2: Crystallize
- Source: the pattern from Stage 1
- Output: skill candidate with purpose, boundary, and basic method
- Völva's responsibility
- Status: `draft`

### Stage 3: Package
- Add: instructions, gotchas, references, scripts, templates, config
- The skill goes from "idea" to "agent can enter this environment"
- Status: `draft` → ready for `sandbox`

### Stage 4: Route
- Define: triggerWhen, doNotTriggerWhen, conflictsWith, mayChainTo
- Register in skill inventory so agents can discover it
- This is when the skill becomes **findable**

### Stage 5: Execute
- Agent loads and runs the skill on real work
- Status: `sandbox`
- Local logs and run history accumulate

### Stage 6: Verify
- Check: did it produce good output? Were smoke checks met? Did human approve?
- Catch: false triggers, missing gotchas, verification gaps

### Stage 7: Learn
- New gotchas confirmed from real failures
- Patches to instructions, references, scripts
- Memory updated (local state + Edda precedent writeback)
- This stage repeats after every significant run

### Stage 8: Govern
- Promotion: sandbox → promoted → core
- Or: merge with another skill, restrict scope, deprecate, retire
- Requires human approval for status changes
- Edda records all governance events

---

## 6. Promotion Path

```text
draft → sandbox → promoted → core
                           → deprecated
                           → superseded
```

### Promotion gates (sandbox → promoted)
- Used successfully 3+ times
- No unresolved critical gotchas
- Clear trigger boundary
- Verification checks exist
- Human review passed

### Retirement criteria
- Replaced by better skill
- No usage for 90 days
- Merged into broader capability

---

## 7. Canonical Examples

### Example A: arch-spec skill lifecycle

```text
CAPTURE:      noticed recurring pattern of "crystallize concepts before planning"
CRYSTALLIZE:  Völva drafts skill candidate: purpose, trigger, boundary
PACKAGE:      add SKILL.md, references/, examples/, review-checklist, promotion-rules
ROUTE:        register trigger: "fuzzy concept needs multi-file spec stack"
EXECUTE:      used on world-design-v0, storage stack
VERIFY:       review output — found review didn't auto-fix, added Step 5
LEARN:        added gotchas.md (G1-G14), added minimum-stack.md
GOVERN:       status: sandbox (used 2x successfully, need 1 more for promotion)
```

### Example B: deploy-service skill lifecycle

```text
CAPTURE:      deploy keeps happening, each time agent re-invents the process
CRYSTALLIZE:  draft skeleton with trigger, checklist, common failures
PACKAGE:      add deploy-checklist.md, smoke-test.sh, prod-rollout-checks.sh, gotchas.md
ROUTE:        trigger: "user requests deploy of specific service with artifact"
EXECUTE:      deploy checkout-service to staging
VERIFY:       staging smoke passed, but healthcheck green ≠ checkout path safe
LEARN:        gotcha confirmed: "must check payment success rate, not just health endpoint"
GOVERN:       promoted after 5 successful deploys, rollback policy added after incident
```

---

## 8. Boundaries / Out of Scope

- This spec defines the **temporal flow** of a skill. The **structural schema** is in `skill-object-v0.md`.
- This spec does NOT define how skills are selected at runtime. See `container-routing-v0.md`.
- This spec does NOT define repo-level ownership of lifecycle fields. See `four-plane-ownership-v0.md`.

---

## Closing Line

> **Skills don't start as specs — they start as patterns noticed in real work. The lifecycle's job is to give those patterns a structured path from ad-hoc solution to governed capability.**
