# T5_03: Budget Tracker

> **Layer**: L2
> **Dependencies**: T5_02, T1_02（audit_log table）
> **Blocks**: T5_04
> **Output**: `checkBudgets` + `recordSpend` + `getSpentToday` + `getSpentInLoop` in risk-assessor.ts

---

## 給 Agent 的起始指令

```bash
cat docs/THYRA/CONTRACT.md             # THY-12 SI-4（花費上限）
cat docs/THYRA/T5_RISK_ASSESSOR.md     # Step 3 — checkBudgets, recordSpend
cat src/db.ts                          # audit_log table 結構
bun run build
```

---

## 實作

### checkBudgets

返回三層預算檢查結果：

```typescript
budget_check: {
  per_action: { limit, current, ok };   // 單次動作上限
  per_day:    { limit, spent, ok };      // 每日總上限
  per_loop:   { limit, spent, ok };      // 每迴圈上限
}
```

- limit 來自 `constitution.budget_limits`
- 無 constitution → 用預設值 `{ max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 }`

### getSpentToday

```sql
SELECT COALESCE(SUM(json_extract(payload, '$.cost')), 0) as total
FROM audit_log WHERE entity_type = 'budget' AND entity_id = ? AND created_at >= ?
```

### getSpentInLoop

```sql
SELECT COALESCE(SUM(json_extract(payload, '$.cost')), 0) as total
FROM audit_log WHERE entity_type = 'budget' AND entity_id = ?
  AND json_extract(payload, '$.loop_id') = ?
```

### recordSpend

```typescript
recordSpend(villageId, loopId, amount): void
// INSERT INTO audit_log — entity_type: 'budget', payload: { cost, loop_id }
```

完整程式碼見 `T5_RISK_ASSESSOR.md` Step 3（class methods）。

---

## 驗收

```bash
bun run build
# recordSpend → getSpentToday 反映正確
# per_action exceeded → budget_check.per_action.ok = false
# per_day accumulated → 正確累計
```
