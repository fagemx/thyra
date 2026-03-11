# T4_03: Law Engine Core

> **Layer**: L2
> **Dependencies**: T4_01, T4_02, T2_02（ConstitutionStore）, T3_02（ChiefEngine）
> **Blocks**: T4_04, T6
> **Output**: `src/law-engine.ts` — LawEngine class

---

## 給 Agent 的起始指令

```bash
cat docs/THYRA/CONTRACT.md             # THY-02, THY-03
cat docs/THYRA/T4_LAW_ENGINE.md        # Step 3 完整 class
cat src/constitution-store.ts          # getActive, checkPermission
cat src/chief-engine.ts                # get(chiefId)
bun run build
```

---

## 關鍵行為

- `constructor(db, constitutionStore, chiefEngine)`
- `propose(villageId, chiefId, input)`:
  1. 取 active constitution → 無則 throw
  2. 驗證 chief 有 `propose_law` 權限
  3. 合憲性檢查（T4_02）→ hard violation = rejected
  4. 計算 risk level → soft violation 升級
  5. Low risk + `enact_law_low` 權限 → auto-approve（status: active, approved_by: auto）
  6. Otherwise → proposed，等人類
- `approve(id, actor)`: proposed → active
- `reject(id, actor, reason?)`: proposed → rejected
- `revoke(id, actor)`: active → revoked
- `rollback(id, actor, reason)`: active → rolled_back
- `evaluate(id, input)`:
  - 寫入 effectiveness（metrics + verdict）
  - harmful + auto-approved → 自動 rollback（THY-03 安全網）
  - harmful + human-approved → 不自動 rollback（通知）
- `get(id)`: 單筆
- `getActiveLaws(villageId, category?)`: active laws，可篩 category
- `list(villageId)`: 所有法律（含歷史）

完整程式碼見 `T4_LAW_ENGINE.md` Step 3。

---

## 驗收

```bash
bun run build
# propose with permissions → success
# propose violating hard rule → rejected
# auto-approve low risk → status active, approved_by auto
# evaluate harmful + auto → auto-rollback
```
