# A3: World API Routes

> **Layer**: L0
> **Dependencies**: A1
> **Blocks**: C, D, E, F, G
> **Output**: `src/routes/world.ts`

Same as v1 — see previous A3. Issue: #183.
7 endpoints on `/api/villages/:id/world/`.

## 驗收
```bash
bun run build && bun run lint && bun test src/routes/world.test.ts
```
