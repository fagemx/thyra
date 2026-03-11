# T3_02: Chief Engine Core

> **Layer**: L2
> **Dependencies**: T3_01, T2_02（ConstitutionStore）, T7_02（SkillRegistry）
> **Blocks**: T3_03, T3_04, T4
> **Output**: `src/chief-engine.ts` — ChiefEngine class

---

## 給 Agent 的起始指令

```bash
cat docs/THYRA/T3_CHIEF_ENGINE.md      # Step 3 完整 class
cat src/constitution-store.ts          # getActive, checkPermission
cat src/skill-registry.ts             # get, validate status
bun run build
```

---

## 關鍵行為

- `constructor(db, constitutionStore, skillRegistry)`
- `create(villageId, input, actor)`:
  1. 取 active constitution → 無則 throw
  2. 驗證 permissions ⊆ constitution.allowed_permissions（THY-09）
  3. 驗證 skill bindings 全部 verified（THY-14）
  4. 寫 DB + audit
- `update(id, input, actor)`: 如改 permissions/skills → 重新驗證
- `deactivate(id, actor)`: status → inactive

完整程式碼見 `T3_CHIEF_ENGINE.md` Step 3。

---

## 驗收

```bash
bun run build
# create with permissions subset → success
# create with permissions exceeding → throw PERMISSION_EXCEEDS_CONSTITUTION
# create with draft skill → throw SKILL_NOT_VERIFIED
```
