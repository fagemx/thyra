# T4_04: Routes + Tests

> **Layer**: L2
> **Dependencies**: T4_02, T4_03
> **Blocks**: 無（T4 完成）
> **Output**: `src/routes/laws.ts`, `src/law-engine.test.ts`

---

## 給 Agent 的起始指令

```bash
cat docs/THYRA/T4_LAW_ENGINE.md        # Step 4 routes, Step 5 tests
cat src/law-engine.ts                  # 確認 core 完成
```

---

## Routes

```
POST   /api/villages/:vid/laws/propose     # Chief 提案
GET    /api/villages/:vid/laws              # 列表（含歷史）
GET    /api/villages/:vid/laws/active       # 只看 active
GET    /api/laws/:id
POST   /api/laws/:id/approve               # 人類審批
POST   /api/laws/:id/reject
POST   /api/laws/:id/revoke
POST   /api/laws/:id/rollback
POST   /api/laws/:id/evaluate              # 效果評估
```

完整 route 程式碼見 `T4_LAW_ENGINE.md` Step 4。

## Tests

覆蓋：
- constitution compliant + low risk + enact_law_low → auto-approved
- constitution compliant + medium risk → status proposed
- violates hard rule → status rejected
- violates soft rule → risk upgraded to medium
- chief lacks propose_law → error
- approve → active
- reject → rejected
- evaluate harmful + auto-approved → auto-rollback
- evaluate harmful + human-approved → stays active
- getActiveLaws → only active + category filter
- rollback → rolled_back

完整測試見 `T4_LAW_ENGINE.md` Step 5。

---

## T4 完成檢查

```
[x] T4_01: Schema + DB
[x] T4_02: Compliance（合憲性+risk分級）
[x] T4_03: Engine Core（propose/approve/reject/rollback/evaluate）
[x] T4_04: Routes + Tests
→ T4 完成，可開始 T6（配合 T5）
```
