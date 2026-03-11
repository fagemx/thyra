# T6_04: Lifecycle Management

> **Layer**: L3
> **Dependencies**: T6_02, T6_03
> **Blocks**: T6_05
> **Output**: `LoopRunner` class（startCycle / abortCycle / timeout / budget）

---

## 給 Agent 的起始指令

```bash
cat docs/THYRA/CONTRACT.md             # THY-08（timeout）, SI-1（人類停止鍵）
cat docs/THYRA/T6_LOOP_RUNNER.md       # Step 2 完整 class
cat src/risk-assessor.ts               # recordSpend
cat src/constitution-store.ts          # budget_limits
bun run build
```

---

## 關鍵行為

### startCycle(opts) → LoopCycle

```typescript
interface StartCycleOpts {
  villageId: string;
  chiefId: string;
  trigger: 'scheduled' | 'event' | 'manual';
  timeoutMs?: number;       // 預設 5 分鐘
  signal?: AbortSignal;     // 人類中斷用
}
```

1. 驗證 chief 存在 + active constitution 存在
2. 建 cycle record（status: running, budget_remaining = max_cost_per_loop）
3. 設 timeout（THY-08）→ 到時間自動 endCycle('timeout')
4. 綁 AbortSignal → abort 時 endCycle('aborted')
5. 呼叫 runLoop（迴圈主體）
6. 清理 timeout + signal listener

### runLoop 迴圈控制

```
while status === 'running' && iterations < MAX_ITERATIONS (10):
  1. 預算檢查 → cost_incurred >= budget_remaining → stop
  2. observe → 無 observation → stop
  3. decide → null → stop
  4. risk gate → act
  5. record cost
  6. evaluate (Phase 0: 簡單記錄)
```

### abortCycle(cycleId, reason)

Safety Invariant #1 實作。人類可隨時呼叫。

- `endCycle(cycleId, 'aborted')`
- 寫 audit_log（actor: 'human'）

### 輔助方法

- `getCycle(id)` — 反序列化 JSON 欄位
- `listCycles(villageId)` — 按 started_at DESC
- `createCycleRecord` — INSERT
- `endCycle` — UPDATE status + ended_at
- `addAction` — 更新 actions JSON 陣列
- `updateCycleCost` — cost_incurred += additional
- `getRecentRollbacks` — 查最近 10 筆 rolled_back laws

完整程式碼見 `T6_LOOP_RUNNER.md` Step 2。

---

## 驗收

```bash
bun run build
# startCycle → running → completed
# timeout → status timeout
# abort → status aborted
# budget exhausted → auto stop
```
