# G1: World Health Metrics + SSE Pulse

> **Layer**: L1
> **Dependencies**: A1（WorldManager）
> **Blocks**: E1（Tonight page SSE 連線）
> **Output**: `src/world/health.ts` + SSE endpoint

合併 v1 的 D1 + D2。Issue: #201 + #202。

computeWorldHealth() + Market-specific metrics +
GET /api/villages/:id/world/pulse SSE stream。

---

## 驗收
```bash
bun run build && bun run lint && bun test src/world/health.test.ts
curl -N http://localhost:3462/api/villages/xxx/world/pulse
```
