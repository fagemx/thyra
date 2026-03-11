# T3_04: Routes + Tests

> **Layer**: L2
> **Dependencies**: T3_02, T3_03
> **Blocks**: 無（T3 完成）
> **Output**: `src/routes/chiefs.ts`, `src/chief-engine.test.ts`

---

## 給 Agent 的起始指令

```bash
cat docs/THYRA/T3_CHIEF_ENGINE.md      # Step 5 routes, Step 6 tests
cat src/chief-engine.ts
```

---

## Routes

```
GET    /api/villages/:vid/chiefs
POST   /api/villages/:vid/chiefs
GET    /api/chiefs/:id
PATCH  /api/chiefs/:id
DELETE /api/chiefs/:id           # → deactivate
GET    /api/chiefs/:id/prompt    # 預覽生成的 prompt
```

## Tests

覆蓋：permissions 超出、draft skill bind、無 constitution、update re-validate、prompt 包含所有 sections。

完整見 `T3_CHIEF_ENGINE.md` Step 6。

---

## T3 完成檢查

```
[x] T3_01: Schema + DB
[x] T3_02: Engine Core（權限/skill 驗證）
[x] T3_03: Prompt Builder
[x] T3_04: Routes + Tests
→ T3 完成，可開始 T4
```
