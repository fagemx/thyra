# T2_04: Routes + Tests

> **Layer**: L1
> **Dependencies**: T2_02, T2_03
> **Blocks**: 無（T2 完成）
> **Output**: `src/routes/constitutions.ts`, `src/constitution-store.test.ts`

---

## 給 Agent 的起始指令

```bash
cat docs/THYRA/CONTRACT.md              # THY-01, THY-11
cat docs/THYRA/T2_CONSTITUTION_STORE.md  # Step 5 routes, Step 6 tests
cat src/constitution-store.ts            # 確認 core 完成
```

---

## Routes

```
GET    /api/villages/:vid/constitutions          # list（含歷史）
POST   /api/villages/:vid/constitutions          # create（首次）
GET    /api/villages/:vid/constitutions/active    # 當前有效
GET    /api/constitutions/:id
POST   /api/constitutions/:id/revoke
POST   /api/constitutions/:id/supersede
# 沒有 PATCH（THY-01）
```

完整 route 程式碼見 `T2_CONSTITUTION_STORE.md` Step 5。

## Tests

完整測試見 `T2_CONSTITUTION_STORE.md` Step 6，覆蓋：
- create + get + list
- 已有 active → create 報錯
- supersede → 舊版 superseded + 新版 active + version +1
- revoke → status revoked
- checkPermission / checkBudget
- supersede chain v1→v2→v3

---

## T2 完成檢查

```
[x] T2_01: Schema + DB — table + Zod
[x] T2_02: Store Core — create/revoke/supersede
[x] T2_03: Validators — checkPermission/Budget/Rules
[x] T2_04: Routes + Tests — API + 全測試通過
→ T2 完成，可開始 T3 和 T5
```
