# T6_02: Observe + Decide

> **Layer**: L3
> **Dependencies**: T6_01, T3_02（ChiefEngine）, T4_03（LawEngine）
> **Blocks**: T6_03
> **Output**: `observe` + `decide` private methods in loop-runner.ts

---

## 給 Agent 的起始指令

```bash
cat docs/THYRA/T6_LOOP_RUNNER.md       # Step 2 — observe/decide
cat src/chief-engine.ts                # Chief 型別 + personality
cat src/law-engine.ts                  # getActiveLaws
bun run build
```

---

## 實作

### observe(villageId) → Observation[]

Phase 0：從 audit_log 收集最近 20 筆變更。

```typescript
interface Observation {
  type: string;       // action name from audit_log
  entity: string;     // entity_type
  payload: Record<string, unknown>;
  timestamp: string;
}
```

```sql
SELECT * FROM audit_log
WHERE entity_id = ? OR json_extract(payload, '$.village_id') = ?
ORDER BY created_at DESC LIMIT 20
```

### decide(chief, laws, observations) → Decision | null

Phase 0：規則式決策（不需 LLM）。

- 遍歷 observations
- 有害 law 評估（`type === 'evaluated' && verdict === 'harmful'`）→ 提議 rollback
- 沒有需要處理的 observation → return null（結束迴圈）

```typescript
interface Decision {
  action: Action;     // 要執行的動作
  reasoning: string;  // 決策理由
}
```

Phase 1 計畫：用 LLM + `buildChiefPrompt` 做真正的推理決策。

完整程式碼見 `T6_LOOP_RUNNER.md` Step 2。

---

## 驗收

```bash
bun run build
# observe 返回 audit_log 最近記錄
# decide 對 harmful evaluation → 返回 rollback decision
# decide 對無 actionable observation → 返回 null
```
