---
name: dispatch
description: Dispatch tasks to Karvi with correct runtime, provider, and model configuration
---

# Task Dispatch Skill

You are a Karvi dispatch specialist. Use this skill to dispatch GitHub issues as tasks to Karvi's execution engine.

## Quick Reference

### CLI Dispatch (recommended)

```bash
# Basic — uses server's default runtime and model
npm run go -- <issue-number>

# Specify runtime
npm run go -- <issue> --runtime opencode
npm run go -- <issue> --runtime codex

# Specify runtime + model (overrides all defaults)
npm run go -- <issue> --runtime opencode --model <provider-id>/<model-id>

# Cross-project dispatch
npm run go -- <issue> --repo C:\path\to\other\project

# Multiple issues
npm run go -- 100 101 102

# Skip confirmation
npm run go -- <issue> -y
```

### curl Dispatch

```bash
curl -X POST http://localhost:3461/api/projects \
  -H "Content-Type: application/json" \
  -d '{
    "title": "GH-XXX: task title",
    "tasks": [{
      "id": "GH-XXX",
      "title": "feat(scope): description",
      "assignee": "engineer_lite",
      "runtimeHint": "opencode",
      "modelHint": "provider-id/model-id",
      "description": "Implement GitHub issue #XXX. See https://github.com/owner/repo/issues/XXX"
    }]
  }'
```

## Runtimes

| Runtime | Tool | Best for | Sandbox |
|---------|------|----------|---------|
| `opencode` | opencode CLI | Flexible, supports custom providers | No sandbox |
| `codex` | Codex CLI | OpenAI models, sandboxed execution | workspace-write |
| `claude` | Claude Code CLI | Anthropic models | No sandbox |

### How runtime is selected

```
1. task.runtimeHint (--runtime flag or payload)
2. controls.preferred_runtime (server setting)
3. "openclaw" (default)
```

## Model Selection

### Priority chain

```
1. task.modelHint        ← per-task (--model flag or payload)
2. model_map[runtime][stepType]  ← global, per step type
3. model_map[runtime].default    ← global fallback
4. null                          ← runtime uses its own default config
```

### model_map format

The `modelHint` and `model_map` values use format: `<provider-id>/<model-id>`

### Built-in vs Custom providers (IMPORTANT)

opencode has two kinds of providers:

| Type | `opencode.json` needed? | API key | Examples |
|------|------------------------|---------|----------|
| **Built-in** | No — shipped with opencode | User pre-configured at opencode/system level | `anthropic`, `openrouter`, `zai-coding-plan`, ... |
| **Custom** | Yes — must exist in project root | In karvi `.env` or system env | User-defined entries in `opencode.json` |

Built-in providers and their default models **vary per user's opencode installation and configuration**. Do not assume any specific provider or model is available.

**How to check what's actually configured:**

```bash
# 1. Check current model_map (what Karvi will use)
curl -s http://localhost:3461/api/controls | node -e "
  const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
  console.log('preferred_runtime:', d.preferred_runtime);
  console.log('model_map:', JSON.stringify(d.model_map, null, 2))"

# 2. Check what opencode sees (from Karvi server startup log)
#    Look for lines like: [opencode] Loaded N provider(s), M model(s)

# 3. Verify a specific model works
opencode run --model <provider>/<model> -- "hello"
```

**Do NOT audit `opencode.json` files to verify built-in providers** — they won't appear there.

The provider-id must match either:
- A built-in opencode provider, OR
- A custom provider defined in `opencode.json` in the project root

### Setting global model_map

```bash
curl -X POST http://localhost:3461/api/controls \
  -H "Content-Type: application/json" \
  -d '{"model_map": {"opencode": {"default": "provider/model"}}}'
```

### Clearing model_map (use runtime defaults)

```bash
curl -X POST http://localhost:3461/api/controls \
  -H "Content-Type: application/json" \
  -d '{"model_map": {}}'
```

## Cross-Project Dispatch

To dispatch tasks to a different repo (e.g., edda issues dispatched from karvi):

### target_repo formats (IMPORTANT)

| Format | Example | OK? |
|--------|---------|-----|
| Absolute path | `"C:\\ai_agent\\edda"` or `"C:/ai_agent/edda"` | ✅ |
| GitHub slug + repo_map | `"fagemx/edda"` | ✅ (needs repo_map) |
| Relative path | `"../edda"` | ❌ Rejected |
| Unescaped Windows path | `"C:\ai_agent\edda"` | ❌ Backslash escape bug |

### What changes with cross-project dispatch

| Item | Without `target_repo` | With `target_repo` |
|------|----------------------|-------------------|
| Worktree location | `karvi/.claude/worktrees/` | `{target_repo}/.claude/worktrees/` |
| Skills loaded | karvi's `.claude/skills/` | target repo's `.claude/skills/` |
| Agent CWD | karvi worktree | target repo worktree |
| `opencode.json` | karvi's | **target repo's** (only matters for custom providers) |
| CLAUDE.md | karvi's | target repo's |
| Task tracking | karvi board | karvi board (centralized) |

### Prerequisites for cross-project dispatch

1. Target repo must be a valid Git repo
2. **Built-in providers** (e.g., `zai-coding-plan`): work out of the box, no extra setup needed
3. **Custom providers** (e.g., `custom-ai-t8star-cn`): target repo must have its own `opencode.json` with the provider definition
4. repo_map configured (if using slug format)

### Setup repo_map for slug-based dispatch

```bash
curl -X POST http://localhost:3461/api/controls \
  -H "Content-Type: application/json" \
  -d '{"repo_map": {"fagemx/edda": "C:/ai_agent/edda"}}'
```

### CLI cross-project (simplest)

```bash
# --repo accepts raw Windows path (shell handles escaping)
npm run go -- <issue> --repo C:\path\to\target\repo

# Multiple issues + model override
npm run go -- 100 101 102 --repo C:\path\to\target\repo --runtime opencode --model <provider>/<model> -y
```

### curl cross-project

```bash
curl -X POST http://localhost:3461/api/projects \
  -H "Content-Type: application/json" \
  -d '{
    "title": "EDDA-145: task title",
    "tasks": [{
      "id": "EDDA-145",
      "title": "feat: description",
      "assignee": "engineer_lite",
      "target_repo": "fagemx/edda",
      "description": "Implement issue fagemx/edda#145"
    }]
  }'
```

## Multi-Model Dispatch (different model per task)

Each task can use a different provider/model via `--model`:

```bash
# Each task gets its own model
npm run go -- 100 --runtime opencode --model <provider-A>/<model-A>
npm run go -- 101 --runtime opencode --model <provider-B>/<model-B>

# Without --model → uses model_map default → then opencode's own default
npm run go -- 102 --runtime opencode

# Different runtime entirely
npm run go -- 103 --runtime codex
```

To find available `<provider>/<model>` values, check `controls.model_map` or ask the user which model to use. Do not guess.

## Pre-Dispatch Checklist

1. **Server running?** `curl http://localhost:3461/api/health/preflight`
   - If not: `cd C:/ai_agent/karvi/server && node server.js &`
2. **Controls correct?** `curl http://localhost:3461/api/controls`
   - `use_worktrees: true` — isolated workspaces
   - `use_step_pipeline: true` — plan → implement → review
3. **Model available?** Check `controls.model_map` for configured defaults. If user specifies a model, trust it. Do NOT audit config files for built-in providers — just dispatch.
4. **Cross-project only**: custom providers need `opencode.json` in target repo root

## Common Pitfalls

| Mistake | Fix |
|---------|-----|
| Auditing config files for built-in providers | Built-in providers (e.g., `zai-coding-plan`) don't appear in `opencode.json` — just dispatch |
| `autoStart: true` in payload | Don't use — bypasses worktree + step pipeline |
| Windows path not escaped in JSON | Use `\\` or `/` in JSON strings |
| Custom provider not found in cross-project | Ensure `opencode.json` is in **target repo** root (not just karvi) |
| model_map overrides your intent | Clear it: `{"model_map": {}}` |
| Task stuck as "dispatched" | Manual dispatch: `curl -X POST .../api/tasks/GH-XXX/dispatch` |

## Monitoring

```bash
# Quick status
curl -s http://localhost:3461/api/board | node -e "
  const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
  d.taskPlan?.tasks?.forEach(t => {
    console.log(t.id, t.status, t.modelHint||'');
    (t.steps||[]).forEach(s => console.log('  ', s.step_id, s.state));
  })"

# Dashboard
open http://localhost:3461
```
