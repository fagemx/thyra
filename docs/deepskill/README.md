# Deep Skill Architecture — README

> Status: `working draft`
>
> This spec stack defines the **skill layer** of the Völva / Karvi / Thyra / Edda system:
> what a governable skill object is, how skills are routed, how they evolve, and who owns what.

---

## Files

| File | Core Question |
|------|---------------|
| `skill-object-v0.md` | What is a governable skill object? (schema, 10 required sections) |
| `container-routing-v0.md` | How does Völva select which container to route a request into? |
| `skill-lifecycle-v0.md` | How does a skill go from ad-hoc pattern to promoted capability? |
| `four-plane-ownership-v0.md` | Which plane (Völva/Karvi/Thyra/Edda) owns which fields? |
| `volva-interaction-model-v0.md` | What does the user see vs what runs behind? |

## Reading Order

1. `volva-interaction-model-v0.md` — start with the user experience
2. `container-routing-v0.md` — how requests find the right container
3. `skill-object-v0.md` — what's inside a skill
4. `skill-lifecycle-v0.md` — how skills evolve
5. `four-plane-ownership-v0.md` — who owns what

## Raw Sources

The `raw/` subfolder contains the original GPT discussion transcripts these specs were extracted from. They are kept for reference but are NOT authoritative — the spec files above are.

## Relationship to Other Spec Stacks

- `docs/world-design-v0/` — defines the world governance runtime (canonical cycle, change proposal, judgment, pulse, outcomes). This stack defines the **skill layer** that sits above it.
- `docs/storage/` — defines how decision state is stored, promoted, and tracked across layers. This stack defines **what skills are**; storage defines **where skill state lives**.
