# T5_04: Routes + Tests

> **Layer**: L2
> **Dependencies**: T5_02, T5_03
> **Blocks**: 無（T5 完成）
> **Output**: `src/routes/assess.ts`, `src/risk-assessor.test.ts`

---

## 給 Agent 的起始指令

```bash
cat docs/THYRA/T5_RISK_ASSESSOR.md     # Step 4 routes, Step 5 tests
cat src/risk-assessor.ts               # 確認 core 完成
```

---

## Routes

```
POST   /api/assess                          # 評估任意動作的風險
GET    /api/villages/:vid/budget             # 查看預算使用
```

完整 route 程式碼見 `T5_RISK_ASSESSOR.md` Step 4。

## Tests

覆蓋：
- SI violation → blocked: true（每條 SI 各測一次）
- budget over per_action limit → blocked
- low risk action → level low
- deploy action → level medium+
- cross village → level high
- recent rollback in category → level high
- no reason provided → SI-2 blocks
- aggressive chief → medium
- budget tracking: recordSpend → getSpentToday reflects
- per_day accumulated correctly

完整測試見 `T5_RISK_ASSESSOR.md` Step 5。

---

## T5 完成檢查

```
[x] T5_01: Safety Invariants + Types（7 條 SI + Action/Result 型別）
[x] T5_02: Assessor Core（三層檢查邏輯）
[x] T5_03: Budget Tracker（spend tracking + 聚合查詢）
[x] T5_04: Routes + Tests
→ T5 完成，可開始 T6
```
