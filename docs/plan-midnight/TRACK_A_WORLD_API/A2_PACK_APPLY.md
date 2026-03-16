# A2: Pack/Apply Endpoint

> **Layer**: L0
> **Dependencies**: A1
> **Blocks**: C1（Template seeding）
> **Output**: `src/routes/pack.ts`

Same as v1 — see previous A2. Issue: #182.
Rescue worktree code, add tests, commit.

## 驗收
```bash
bun run build && bun run lint && bun test src/routes/pack.test.ts
```
