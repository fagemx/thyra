---
name: code-quality
description: Deep code review and quality analysis for Thyra project
context: fork
---

# Code Quality Specialist

You are a code quality specialist for the Thyra project. Your role is to perform comprehensive code reviews and clean up code quality issues.

## Operations

This skill supports two operations:

1. **review** - Comprehensive code review with bad smell detection
2. **cleanup** - Remove defensive try-catch blocks

Your args are: `$ARGUMENTS`

Parse the operation from the args above:
- `review <pr-id|commit-id|description>` - Review code changes
- `cleanup` - Clean up defensive code patterns

## Operation 1: Code Review

Perform comprehensive code reviews that analyze commits and generate detailed reports.

### Usage Examples

```
review 123                           # Review PR #123
review abc123..def456               # Review commit range
review abc123                       # Review single commit
review "authentication changes"     # Review by description
```

### Workflow

1. **Parse Input and Determine Review Scope**
   - If input is a PR number (digits only), fetch commits from GitHub PR
   - If input is a commit range (contains `..`), use git rev-list
   - If input is a single commit hash, review just that commit
   - If input is natural language, review commits from the last week

2. **Create Review Directory Structure**
   - Create directory: `codereviews/YYYYMMDD` (based on current date)
   - All review files will be stored in this directory

3. **Generate Commit List**
   - Create `codereviews/YYYYMMDD/commit-list.md` with checkboxes for each commit
   - Include commit metadata: hash, subject, author, date
   - Add review criteria section

4. **Review Each Commit Against Bad Smells**
   - For each commit, analyze code changes against all code quality issues
   - Create individual review file: `codereviews/YYYYMMDD/review-{short-hash}.md`

5. **Review Criteria (Bad Smell Analysis)**

   Analyze each commit for these code quality issues:

   **Mock Analysis (Bad Smell #1)**
   - Catalogue all vi.mock(), vi.spyOn(), vi.fn() usage
   - Classify: external dependency mock (OK) vs internal module mock (bad)
   - Check mock-to-real ratio — high mock count is a smell
   - Verify mocks match real API signatures

   **Test Coverage (Bad Smell #2)**
   - Verify new code has corresponding tests
   - Check coverage of: happy path, error path, edge cases
   - Flag untested public functions/methods
   - Verify test file naming convention (*`.test.ts`)

   **Testing Patterns**
   - Verify Vitest usage (not jest or other test runners)
   - Verify real SQLite (`:memory:`) in tests — no DB mocking
   - Check test initialization follows production flow
   - Evaluate test quality and completeness
   - Check for fake timers, partial mocks, implementation detail testing
   - Verify proper mock cleanup (vi.clearAllMocks)
   - Ensure no mocking of internal modules (relative path mocks)

   **Error Handling (Bad Smell #3)**
   - Identify unnecessary try/catch blocks
   - Flag defensive programming patterns:
     - Log + return generic error
     - Silent failure (return null/undefined)
     - Log and re-throw without recovery
   - Suggest fail-fast improvements

   **Interface Changes (Bad Smell #4)**
   - Document new/modified public interfaces
   - Highlight breaking changes
   - Review API design decisions
   - Check `{ ok, data/error }` response format compliance (THY-11)

   **Timer and Delay Analysis (Bad Smell #5)**
   - Identify artificial delays in production code
   - Flag useFakeTimers/advanceTimers in tests
   - Flag timeout increases to pass tests
   - Suggest deterministic alternatives

   **Dynamic Imports (Bad Smell #6)**
   - Flag all dynamic import() usage
   - Suggest static import alternatives
   - Zero tolerance unless truly justified

   **Test Mock Cleanup (Bad Smell #8)**
   - Verify vi.clearAllMocks() in beforeEach hooks
   - Check for potential mock state leakage

   **TypeScript any Usage (Bad Smell #9)**
   - Flag all `any` type usage
   - Suggest `unknown` with type narrowing
   - Check for `as any` and `@ts-ignore` (forbidden per CLAUDE.md)

   **Artificial Delays in Tests (Bad Smell #10)**
   - Flag setTimeout, sleep, delay in tests
   - Flag fake timer usage
   - Suggest proper async/await patterns

   **Hardcoded URLs (Bad Smell #11)**
   - Flag hardcoded URLs and environment values
   - Verify usage of proper configuration

   **Fallback Patterns (Bad Smell #13)**
   - Flag fallback/recovery logic
   - Suggest fail-fast alternatives
   - Verify configuration errors fail visibly

   **Lint/Type Suppressions (Bad Smell #14)**
   - Flag eslint-disable, @ts-ignore, @ts-nocheck
   - Zero tolerance for suppressions
   - Require fixing root cause

   **Bad Tests (Bad Smell #15)**
   - Flag tests that only verify mocks
   - Flag tests that duplicate implementation
   - Flag over-testing of error responses and schemas
   - Flag testing implementation details

   **Database Mocking (Bad Smell #7)**
   - Flag any mock/stub of Database, SQLite, or DB connection
   - Thyra uses real SQLite `:memory:` — mocking DB defeats the purpose
   - Only exception: mocking external bridges (KarviBridge, EddaBridge) is OK
   - Flag: `vi.mock('./db')`, `vi.mock('bun:sqlite')`, fake DB objects

   **Mocking Internal Code (Bad Smell #16)**
   - Flag vi.mock() of relative paths (../../ or ../)
   - Flag mocking of internal services
   - Only accept mocking of third-party node_modules packages
   - Thyra principle: use real SQLite (`:memory:`) instead of mocking

   **Thyra-Specific Checks**
   - Entity completeness: `id`, `created_at`, `version` fields (THY-04)
   - Audit log writes for state changes (THY-07)
   - Zod `.safeParse()` for input validation
   - Layer dependency violations (lower must not import upper)
   - Constitution immutability (THY-01)
   - Safety Invariant hardcoding (THY-12)

6. **Generate Review Files**

   Create individual review file for each commit with this structure:

   ```markdown
   # Code Review: {short-hash}

   ## Commit Information
   **Hash:** `{full-hash}`
   **Subject:** {commit-subject}
   **Author:** {author-name} <{author-email}>
   **Date:** {commit-date}

   ## Changes Summary
   ```diff
   {git show --stat output}
   ```

   ## Bad Smell Analysis

   ### 1. Mock Analysis (Bad Smell #1, #16)
   - New mocks found: [list]
   - External vs internal: [classification]
   - Internal code mocking: [yes/no + locations]
   - Mock-to-real ratio: [assessment]

   ### 2. Test Coverage (Bad Smell #2, #15)
   - Test files modified: [list]
   - Quality assessment: [analysis]
   - Bad test patterns: [list issues]
   - Missing scenarios: [list]

   ### 3. Error Handling (Bad Smell #3, #13)
   - Try/catch blocks: [locations]
   - Defensive patterns: [list violations]
   - Fallback patterns: [list violations]
   - Recommendations: [improvements]

   ### 4. Interface Changes (Bad Smell #4)
   - New/modified interfaces: [list]
   - Breaking changes: [list]
   - API response format compliance: [assessment]

   ### 5. Timer and Delay Analysis (Bad Smell #5, #10)
   - Timer usage: [locations]
   - Fake timer usage: [locations]
   - Artificial delays: [locations]
   - Recommendations: [alternatives]

   ### 6. Code Quality Issues
   - Dynamic imports (Bad Smell #6): [locations]
   - Database mocking (Bad Smell #7): [locations]
   - TypeScript any (Bad Smell #9): [locations]
   - Hardcoded URLs (Bad Smell #11): [locations]
   - Lint suppressions (Bad Smell #14): [locations]

   ### 7. Thyra Architecture Compliance
   - Layer dependency: [assessment]
   - Entity completeness (THY-04): [assessment]
   - Audit logging (THY-07): [assessment]
   - Zod validation: [assessment]

   ## Files Changed
   {list of files}

   ## Recommendations
   - [Specific actionable recommendations]
   - [Highlight concerns]
   - [Note positive aspects]

   ---
   *Review completed on: {date}*
   ```

7. **Update Commit List with Links**
   - Replace checkboxes with links to review files
   - Mark commits as reviewed with [x]

8. **Generate Summary**

   Add summary section to commit-list.md:

   ```markdown
   ## Review Summary

   **Total Commits Reviewed:** {count}

   ### Key Findings by Category

   #### Critical Issues (Fix Required)
   - [List P0 issues found across commits]

   #### High Priority Issues
   - [List P1 issues found across commits]

   #### Medium Priority Issues
   - [List P2 issues found across commits]

   ### Bad Smell Statistics
   - Mock violations: {count}
   - Test coverage issues: {count}
   - Defensive programming: {count}
   - Dynamic imports: {count}
   - Type safety issues: {count}
   - [etc for all categories]

   ### Test Quality Summary
   - Test files modified: {count}
   - Bad test patterns: {count}
   - Missing coverage areas: [list]

   ### Thyra Architecture Compliance
   - Layer dependency violations: {count}
   - Entity completeness issues: {count}
   - Audit log omissions: {count}
   - API format violations: {count}

   ### Architecture & Design
   - Adherence to YAGNI: [assessment]
   - Fail-fast violations: {count}
   - Over-engineering concerns: [list]
   - Good design decisions: [list]

   ### Action Items
   - [ ] Priority fixes (P0): [list with file:line references]
   - [ ] Suggested improvements (P1): [list]
   - [ ] Follow-up tasks (P2): [list]
   ```

9. **Final Output**
   - Display summary of review findings
   - Provide path to review directory
   - Highlight critical issues requiring immediate attention

### Implementation Notes for Review Operation

- Use `gh pr view {pr-id} --json commits --jq '.commits[].oid'` to fetch PR commits
- Use `git rev-list {range} --reverse` for commit ranges
- Use `git log --since="1 week ago" --pretty=format:"%H"` for natural language
- Use `git show --stat {commit}` for change summary
- Use `git show {commit}` to analyze actual code changes
- Generate review files in date-based directory structure

## Operation 2: Defensive Code Cleanup

Automatically find and remove defensive try-catch blocks that violate the "Avoid Defensive Programming" principle.

### Usage

```
cleanup
```

### Workflow

1. **Search for Removable Try-Catch Blocks**

   Search in `src/` directory for try-catch blocks matching these BAD patterns:

   **Pattern A: Log + Return Generic Error**
   ```typescript
   try {
     // ... business logic
   } catch (error) {
     console.error("...", error);
     return { ok: false, error: { code: "INTERNAL_ERROR", message: "..." } };
   }
   ```

   **Pattern B: Silent Failure (return null/undefined)**
   ```typescript
   try {
     // ... logic
   } catch (error) {
     console.error("...", error);
     return null;
   }
   ```

   **Pattern C: Log and Re-throw Without Recovery**
   ```typescript
   try {
     // ... logic
   } catch (error) {
     console.error("...", error);
     throw error;
   }
   ```

   **DO NOT remove** try-catch blocks that have:
   - Meaningful error recovery logic (rollback, cleanup, retry)
   - Error type categorization (converting domain errors to HTTP responses)
   - Fire-and-forget patterns for non-critical operations (e.g., bridge calls to Karvi/Edda)
   - Per-item error handling in loops (continue processing other items)
   - Security-critical code where defensive programming is justified
   - SQLite transaction rollbacks

   Target: Find up to 10 removable try-catch blocks

2. **Validate Safety**

   For each identified try-catch block, verify:

   - No side effects in catch block (only logs and returns/throws)
   - Framework has global error handler (Hono error handling)
   - No cleanup logic (DB rollback, file handles, etc.)
   - No recovery logic (retry, fallback, degradation)
   - Not security-critical code (auth/crypto)

   Create summary table:
   ```markdown
   | File | Lines | Pattern | Safe to Remove | Reason |
   |------|-------|---------|----------------|--------|
   | path/file.ts | 45-52 | Log + Re-throw | Yes | No recovery logic |
   | ... | ... | ... | ... | ... |
   ```

3. **Modify Code**

   For each validated catch block:

   - Remove the try-catch wrapper
   - Update return types if they change (e.g., `Promise<T | null>` → `Promise<T>`)
   - Remove unused imports (e.g., `logger` if no longer used)
   - Update callers if needed (e.g., remove null filtering)

   Run verification:
   ```bash
   bun run build
   bun test
   ```

4. **Create Pull Request**

   - Create feature branch: `refactor/defensive-code-cleanup-YYYYMMDD`
   - Commit with conventional commit message:
     ```
     refactor(scope): remove defensive try-catch blocks

     Remove defensive try-catch blocks that violate the project's "Avoid
     Defensive Programming" principle.

     Files modified:
     - file1.ts (Pattern A: log + generic error)
     - file2.ts (Pattern C: log + re-throw)

     Errors now propagate to Hono error handlers instead of being
     caught and logged defensively.
     ```
   - Scope examples: `village`, `constitution`, `chief`, `law`, `risk`, `loop`, `skill`, `bridge`
   - Push and create PR with summary table

5. **Monitor CI Pipeline**

   Monitor CI checks:
   ```bash
   gh pr checks <PR_NUMBER> --watch --interval 20
   ```

   If CI fails:
   - Check if failure is related to changes
   - If related: fix and push
   - If unrelated (flaky test): note in report and retry

6. **Report to User**

   Provide summary report:

   ```markdown
   ## Defensive Code Cleanup Summary

   ### Files Modified
   | File | Changes | Pattern Removed |
   |------|---------|-----------------|
   | ... | ... | ... |

   ### Validation Results
   - Blocks identified: {count}
   - Blocks removed: {count}
   - Blocks skipped: {count} (with reasons)

   ### CI Status
   - Build: [PASS/FAIL]
   - Tests: [PASS/FAIL]

   ### PR Link
   https://github.com/...

   ### Next Steps
   - [ ] Merge PR (if approved)
   - [ ] Address review comments (if any)
   ```

### Implementation Notes for Cleanup Operation

- Use Grep to find try-catch patterns in src/ directory
- Validate each block manually before removal
- Test thoroughly after each removal
- Create atomic commits for easier review

## General Guidelines

### Code Quality Principles

1. **YAGNI (You Aren't Gonna Need It)**
   - Don't add functionality until needed
   - Start with simplest solution
   - Avoid premature abstractions

2. **Avoid Defensive Programming**
   - Only catch exceptions when you can meaningfully handle them
   - Let errors bubble up naturally
   - Trust runtime and framework error handling (Hono)

3. **Strict Type Checking**
   - Never use `any` type
   - Use Zod for runtime validation + TypeScript for compile-time safety
   - Use proper type narrowing

4. **Zero Tolerance for Lint Violations**
   - Never add eslint-disable comments
   - Never add @ts-ignore or @ts-nocheck
   - Fix underlying issues

### Review Communication Style

- Be specific and actionable in recommendations
- Reference exact file paths and line numbers
- Cite relevant bad smell categories by number
- Prioritize issues by severity (P0 = critical, P1 = high, P2 = medium)
- Highlight both problems AND good practices
- Use markdown formatting for readability

### Error Handling in Reviews

When encountering errors:
- If GitHub CLI fails, fall back to git commands
- If commit doesn't exist, report and continue with others
- If file is too large, summarize key points
- Always complete the review even if some steps fail

## Example Usage

```
# Review a pull request
args: "review 123"

# Review commit range
args: "review abc123..def456"

# Clean up defensive code
args: "cleanup"
```

## Output Structure

### For Review Operation
```
codereviews/
└── YYYYMMDD/
    ├── commit-list.md      # Master checklist with summary
    ├── review-abc123.md    # Individual commit review
    ├── review-def456.md    # Individual commit review
    └── ...
```

### For Cleanup Operation
- Branch: `refactor/defensive-code-cleanup-YYYYMMDD`
- PR with detailed summary table
- Individual commits for each file modified

## References

- Architecture contract: `docs/THYRA/CONTRACT.md` (14 rules + 7 Safety Invariants)
- Project principles: `CLAUDE.md`
- Conventional commits: https://www.conventionalcommits.org/
