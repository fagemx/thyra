# Code Review: 8db73c6

## Commit Information
**Hash:** `8db73c69cbdae5809fab3d9b8a28684ee55fcd5c`
**Subject:** fix(lint): replace deprecated db.exec and reduce function complexity
**Author:** fagemx <fagemtez@gmail.com>
**Date:** Sun Mar 15 12:08:13 2026 +0800
**PR:** #166

## Changes Summary
```
 src/db.ts              |   8 +-
 src/decision-engine.ts | 256 +++++++++++++++++++-----------
 src/loop-runner.ts     | 214 +++++++++++++------------
 src/pack/cli.ts        |   4 +-
 src/pack/compiler.ts   |  59 +++++--
 src/world/change.ts    | 413 +++++++++++++++++++++++++++++--------------------
 6 files changed, 572 insertions(+), 382 deletions(-)
```

## Bad Smell Analysis

### 1. Mock Analysis (Bad Smell #1, #16)
- No new mocks introduced.
- N/A — production code refactoring only.

### 2. Test Coverage (Bad Smell #2, #15)
- No test files modified.
- **Assessment:** This is a large refactoring (6 files, +572/-382 lines). The commit message says "reduce function complexity" — function extraction preserves behavior, so existing tests should cover it. However, the refactoring is significant enough that test verification is important. The PR should have CI green.

### 3. Error Handling (Bad Smell #3, #13)

#### decision-engine.ts — `applyLlmAdvisor` method
The LLM advisor try/catch blocks were moved from inline to a new private method. The pattern is preserved:
```typescript
try { ... } catch (err) {
  appendAudit(this.db, 'llm_advisor', ...);
}
```
**Assessment:** These are fire-and-forget LLM calls with fallback to rule-based — this is a legitimate use of try/catch (non-critical external dependency). Acceptable.

**Issue (P1):** In the new `applyLlmAdvisor` method, line:
```typescript
const advisor = this.llmAdvisor!;
```
Uses a non-null assertion (`!`). This was in the original code's context where `if (this.llmAdvisor)` guarded it, but now it's in a separate method. The caller does check `if (this.llmAdvisor)` before calling, but the `!` assertion inside the method is not ideal. A proper null guard or passing the advisor as a parameter would be cleaner. **NOTE: PR #168 addresses non-null assertions separately.**

#### loop-runner.ts — `recordDecisionAudit` and `handleDispatchTask`
Extracted from inline code. The Edda fire-and-forget pattern is preserved:
```typescript
void this.eddaBridge.recordDecision({...}).catch(() => {});
```
**Assessment:** Acceptable — fire-and-forget for non-critical external bridge.

### 4. Interface Changes (Bad Smell #4)
- No public interface changes.
- New private methods added to `DecisionEngine`: `collectReasoningFactors`, `collectPrecedentNotes`, `buildPersonalityEffect`, `applyLlmAdvisor`, `buildDecideResult`, `buildDecisionSummary`.
- New private methods added to `LoopRunner`: `handleDispatchTask`, `recordDecisionAudit`.
- New private methods in `VillagePackCompiler`: `compileLawsPropose`, `compileLawsRevoke`, `compileLawsReplace`.
- `world/change.ts`: switch cases extracted to module-level functions (`applyConstitutionSupersede`, `applyLawPropose`, etc.).

### 5. Timer and Delay Analysis (Bad Smell #5, #10)
- `await new Promise((resolve) => setTimeout(resolve, 0))` preserved in loop-runner — this is a yield-to-event-loop pattern, not an artificial delay. Acceptable.

### 6. Code Quality Issues

#### db.exec → db.run replacement
- `db.exec()` replaced with `db.run()` in 6 locations across db.ts and pack/cli.ts.
- **Assessment:** If `db.exec` is deprecated in the Bun SQLite API, this is correct. Both execute SQL without returning results. However, `db.run()` typically expects a single statement, while `db.exec()` can handle multiple statements. The `initSchema` function passes a large multi-statement SQL string to `db.run()` — this works in Bun's SQLite but is worth noting.

#### world/change.ts extraction
- The large switch statement in `applyChange` was extracted to 13 individual functions.
- **Assessment:** Good refactoring. Each function is typed with `Extract<WorldChange, { type: '...' }>` which provides proper type narrowing. The module-level functions (not class methods) are appropriate since `applyChange` is a pure function.

#### decision-engine.ts extraction
- `decide()` method broken into 6 private methods.
- **Assessment:** Reasonable decomposition. The `decide()` method was likely flagged by a complexity linter. The extracted methods have clear responsibilities.
- **Concern (P2):** `buildDecideResult` takes 8 parameters — this is a code smell. Consider using a builder object or a struct to group related parameters.

#### pack/compiler.ts — non-null assertions remain
- Lines with `chiefId!` in `compileLawsPropose` and `compileLawsReplace` calls.
- **Assessment (P1):** The `!` assertions on `chiefId` are carried over from the original code. The guard `if (!chiefId && !dryRun)` above means `chiefId` could still be undefined in dryRun mode, yet the `!` assertion is used unconditionally. This is a latent bug — if `compileLawsPropose` is called in non-dryRun mode, `chiefId` is guaranteed non-null, but the `!` hides this from the type checker.

- Dynamic imports (Bad Smell #6): None
- Database mocking (Bad Smell #7): None
- TypeScript any (Bad Smell #9): None introduced
- Hardcoded URLs (Bad Smell #11): None
- Lint suppressions (Bad Smell #14): None

### 7. Thyra Architecture Compliance
- Layer dependency: OK — `loop-runner.ts` imports types from `decision-engine` (same layer). No violations.
- Entity completeness (THY-04): N/A
- Audit logging (THY-07): Audit logging preserved in extracted methods.
- Zod validation: N/A

## Files Changed
- src/db.ts
- src/decision-engine.ts
- src/loop-runner.ts
- src/pack/cli.ts
- src/pack/compiler.ts
- src/world/change.ts

## Recommendations
- **P1**: `this.llmAdvisor!` non-null assertion in `applyLlmAdvisor` — pass advisor as parameter or add guard. (Partially addressed by PR #168)
- **P1**: `chiefId!` non-null assertions in compiler.ts `compileLaws*` calls — should add proper guards.
- **P2**: `buildDecideResult` has 8 parameters — consider grouping into a context object.
- **Positive**: Good use of `Extract<WorldChange, { type: '...' }>` for type narrowing in `world/change.ts`.
- **Positive**: Clean mechanical refactoring — behavior preserved, complexity reduced.

---
*Review completed on: 2026-03-15*
