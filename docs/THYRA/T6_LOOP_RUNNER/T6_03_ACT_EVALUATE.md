# T6_03: Act + Evaluate

> **Layer**: L3
> **Dependencies**: T6_02, T5_02（RiskAssessor）, T4_03（LawEngine）
> **Blocks**: T6_04
> **Output**: `execute` + risk gate + cost tracking in loop-runner.ts

---

## 給 Agent 的起始指令

```bash
cat docs/THYRA/T6_LOOP_RUNNER.md       # Step 2 — execute + risk gate
cat src/risk-assessor.ts               # assess, recordSpend
cat src/law-engine.ts                  # propose
bun run build
```

---

## 實作

### Risk Gate（在 runLoop 中）

每個 decision 執行前，先過 RiskAssessor：

```typescript
const assessment = riskAssessor.assess(decision.action, {
  constitution,
  recent_rollbacks: getRecentRollbacks(villageId),
  chief_personality: chief.personality,
  loop_id: cycle.id,
});

if (assessment.blocked) → addAction(outcome: 'blocked'), continue
if (assessment.level !== 'low') → addAction(outcome: 'pending_approval'), continue
// low risk → execute
```

### execute(decision, cycle) → ExecuteResult

Phase 0 支援的動作：
- `propose_law` → 透過 LawEngine propose
- `dispatch_task` → Phase 1（Karvi Bridge）
- 其他 → `{ success: false, reason: 'unknown_action_type' }`

### Cost Tracking

每次執行後，如果有花費：
1. `riskAssessor.recordSpend(villageId, cycleId, cost)` — 寫 audit_log
2. `updateCycleCost(cycleId, cost)` — 更新 loop_cycles.cost_incurred

### addAction

記錄每個動作到 cycle.actions（JSON 陣列更新）。

完整程式碼見 `T6_LOOP_RUNNER.md` Step 2（runLoop 方法內）。

---

## 驗收

```bash
bun run build
# blocked action → 記錄為 blocked
# medium/high risk → 記錄為 pending_approval
# low risk → 執行 + 記錄花費
```
