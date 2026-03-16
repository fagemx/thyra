---
name: code-review
description: "Retrospective code review: parallel 3-way analysis with structured findings and issue decomposition"
---

# Code Review Skill (Retrospective)

Full codebase or commit-range review, split into 3 parallel analysis tracks. Produces structured findings with severity ratings, then optionally decomposes into GitHub issues.

Unlike `pr-review` (single PR, pre-merge), this skill reviews **already-merged code** or **entire codebases** for quality, security, and architectural compliance.

## Usage

```
code-review                          # Review all code in src/
code-review <commit-range>           # Review specific commits (e.g., abc123..HEAD)
code-review --path src/routes        # Review specific directory
code-review --create-issues          # Auto-create GitHub issues from findings
```

## Customization

This skill auto-detects project context from `CLAUDE.md`. To customize review criteria per project, add a `.claude/review-config.md` file (optional):

```markdown
# Review Config

## Architecture Rules
- List your hard constraints here (e.g., "lower layers must not import upper layers")
- Reference your contract doc (e.g., "see docs/CONTRACT.md")

## Safety Invariants
- List invariants that must never be violated (e.g., "SI-1: human can always stop agent")

## Tech Stack Checks
- Framework-specific concerns (e.g., "all routes must use Zod safeParse")
- Runtime quirks (e.g., "Bun.serve mock servers need explicit stop in afterEach")

## Ignore Patterns
- Files or patterns to skip (e.g., "node_modules/", "*.generated.ts")
```

If no config exists, **auto-generate one** before proceeding:

1. Read `CLAUDE.md` for architecture rules, conventions, safety constraints
2. Read `package.json` / `tsconfig.json` for tech stack
3. Generate `.claude/review-config.md` with extracted rules
4. Show the user and ask for confirmation before continuing

This means: **first run on any project auto-creates the config. Subsequent runs reuse it.**

---

## Workflow

### Step 0: Detect Scope and Context

```bash
# Determine what to review
if [ -n "$COMMIT_RANGE" ]; then
  # Commit range mode: only review changed files
  git diff $COMMIT_RANGE --name-only | grep -E '\.(ts|js|tsx|jsx)$'
else
  # Full scan mode: all source files
  find src/ -name '*.ts' -o -name '*.js' | grep -v node_modules | grep -v '.test.'
fi
```

Read project context:
1. `CLAUDE.md` — architecture rules, conventions, tech stack
2. `.claude/review-config.md` — custom review criteria (if exists)
3. `package.json` / `tsconfig.json` — dependencies, compiler options

### Step 1: Classify Files into 3 Review Tracks

Split all files into 3 groups for parallel review:

| Track | Contents | Focus |
|-------|----------|-------|
| **Core** | Business logic, domain models, engines, state management | Architecture, correctness, safety |
| **Interface** | Routes, schemas, bridges, API handlers, external integrations | Validation, consistency, security |
| **Tests** | All test files (*.test.ts, *.spec.ts, tests/**) | Coverage, quality, isolation |

Classification rules:
- `routes/`, `schemas/`, `*-bridge.*` → Interface
- `*.test.*`, `*.spec.*`, `tests/` → Tests
- Everything else → Core
- `index.ts` / `main.ts` → Core (wiring)

### Step 2: Launch 3 Parallel Review Agents

Launch 3 Agent tool calls simultaneously, one per track. Each agent receives:

1. The file list for its track
2. The project context (from Step 0)
3. Track-specific review checklist (below)
4. Output format specification

#### Track A: Core Review Checklist

```
1. Architecture compliance — does code follow documented constraints?
2. Layer dependencies — no upward imports in layered architecture?
3. Type safety — any `any`, `@ts-ignore`, unsafe casts?
4. Data integrity — audit logs consistent? JSON serialization correct?
5. State management — transactions where needed? Race conditions?
6. Error handling — appropriate error types? No swallowed errors?
7. Security — SQL injection? Command injection? Input trust boundaries?
8. Dead code — empty implementations, unreachable branches, stubs left behind?
```

#### Track B: Interface Review Checklist

```
1. Input validation — all endpoints use schema validation (Zod/Joi/etc)?
2. Response format — consistent across all endpoints?
3. HTTP status codes — correct for each scenario (201 create, 404 not found, etc)?
4. Error responses — structured, informative, no stack traces leaked?
5. External integration — graceful degradation when dependencies are down?
6. Schema quality — naming consistent? Versions? Forward compatibility?
7. Security — no SQL injection, XSS, or command injection at boundaries?
8. Rate limiting / bounds — query params validated (limit, offset, etc)?
```

#### Track C: Test Review Checklist

```
1. Coverage — happy path + error path + edge cases for each module?
2. Safety invariants — dedicated tests for each SI?
3. False positives — assertions specific enough? No always-pass tests?
4. Isolation — each test has own state? No order dependencies?
5. Mock strategy — mocking at correct boundaries? No over-mocking?
6. Missing scenarios — what critical paths are untested?
7. Test quality — readable? Descriptive names? Clear arrange-act-assert?
```

#### Agent Prompt Template

Each agent receives this prompt (with track-specific variables filled in):

```
你是 AI tech lead，對 {project_name} 做回顧性 code review。
風格：簡潔、直接、可操作。用戶的語言回覆。

Review 範圍：{track_name}

讀取以下檔案並做 review：
{file_list}

Review 重點：
{checklist}

{project_context}

輸出格式：
## [檔案名] — 評分 (A/B/C/D)

### 問題
- 🔴 P0: [必須修] 描述 (file:line)
- 🟡 P1: [建議修] 描述 (file:line)
- 🟢 OK: [做得好] 描述

最後給一個總結表格 + {track_specific_summary}
```

Track-specific summary requirements:
- **Core**: "跨模組系統性問題" section
- **Interface**: "API 一致性矩陣" section
- **Tests**: "缺漏清單 — 列出最重要的 5 個應該補的測試"

### Step 3: Aggregate Results

After all 3 agents complete, aggregate into a unified report:

```markdown
# Code Review Report — {project_name}

## Overall Score: {weighted_average}

| 面向 | 評分 | 說明 |
|------|------|------|
| 架構 / Core | {score} | {1-sentence} |
| 介面 / Interface | {score} | {1-sentence} |
| 測試 / Tests | {score} | {1-sentence} |

## P0 — Must Fix ({count})

| # | 位置 | 問題 |
|---|------|------|
| 1 | file:line | description |

## P1 — Should Fix ({count})

| # | 問題 | 影響範圍 |
|---|------|---------|
| 1 | description | modules |

## Test Gaps — Top 5

| # | 應補測試 | 風險 |
|---|---------|------|
| 1 | description | risk |

## Systemic Issues

{cross-cutting concerns from all 3 tracks}
```

### Step 4: Create Issues (if --create-issues)

If the user confirms, decompose findings into GitHub issues:

1. **Each P0 → 1 issue** with label `bug, P0, {module}`
2. **Related P1s → group by module** if they touch the same files
3. **Test gaps → 1 issue per gap** with label `test, P1, {module}`
4. **Systemic issues → 1 issue each** with label `tech-debt, P1`

Follow `plan-decompose` confirmation flow:
- Show confirmation table
- Wait for user approval
- Batch create with `gh issue create`
- Report created issue numbers

---

## Scoring Guide

| Grade | Meaning |
|-------|---------|
| A | Production-ready. Minor style suggestions at most. |
| B+ | Solid but has gaps. 1-2 P1 issues. |
| B | Functional but needs attention. P1 issues or missing validation. |
| C | Significant problems. P0 issues present. |
| D | Architectural or security issues. Do not deploy. |

---

## Anti-Patterns

1. **Review without reading** — Always read files before judging
2. **Style nitpicks** — Focus on correctness, security, architecture. Not formatting.
3. **Vague findings** — Every finding needs file:line evidence
4. **Over-praise** — Don't say "great job" on every file. Be direct.
5. **Missing context** — Always read CLAUDE.md / project docs first
6. **Reviewing generated code** — Skip auto-generated files, lock files, etc.
7. **One-size-fits-all** — Respect project-specific constraints from config

## Compared to Other Skills

| Skill | When to Use |
|-------|-------------|
| `pr-review` | Single PR, pre-merge, on open PR |
| `code-review` | Retrospective, full codebase or commit range, post-merge |
| `issue-scan` | Proactive discovery of new work (bugs, features, tech debt) |
| `plan-validate` | Validate a plan against actual code |
