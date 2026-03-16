# D2: Governance Scheduler

> **Layer**: L2
> **Dependencies**: D1
> **Blocks**: D3
> **Output**: `src/governance-scheduler.ts`

Timer-driven scheduler，每 15-30 分鐘跑一輪所有 chiefs（sequential）。
Apply 完後觸發 adapter actions（fire-and-forget）。

跟 v1 C2 相同核心設計 + 加入 adapter dispatch。

Issue: #199

## 驗收
```bash
bun run build && bun run lint && bun test src/governance-scheduler.test.ts
```
