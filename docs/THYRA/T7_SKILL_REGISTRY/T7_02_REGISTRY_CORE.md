# T7_02: Skill Registry Core

> **Layer**: L1
> **Dependencies**: T7_01
> **Blocks**: T7_03, T3_02（ChiefEngine 用 validateSkillBindings）
> **Output**: `src/skill-registry.ts` — SkillRegistry class

---

## 給 Agent 的起始指令

```bash
cat docs/THYRA/CONTRACT.md             # THY-13（skill version）, THY-14（verified only）
cat docs/THYRA/T7_SKILL_REGISTRY.md    # Step 3 完整 class
bun run build
```

---

## 關鍵行為

- `constructor(db)`
- `create(input, actor): Skill` — 新建 skill（status: draft）
- `get(id): Skill | null`
- `getByNameVersion(name, version, villageId?): Skill | null`
- `list(filters?): Skill[]` — 可篩 village / status / name
- `update(id, input, actor): Skill` — version +1，新 row（舊版保留，不自動升級）
- `verify(id, actor): Skill` — status → verified，記錄 verified_at + verified_by
- `deprecate(id, actor): Skill` — status → deprecated
- `getAvailable(villageId): Skill[]` — 該 Village 可用的 skills（village-scoped + global，只含 verified）

### Skill 版本策略（THY-13）

```
update(id, input) → 建新 row（version+1, status: draft），原 row 不動
→ 已 bind 舊版的 Chief 不受影響
→ 新版需重新 verify 才能被 bind
```

### Skill 共享

- `village_id = null` → global skill，所有 Village 可用
- `village_id = 'xxx'` → 只有該 Village 可用
- `getAvailable(villageId)` → `WHERE (village_id = ? OR village_id IS NULL) AND status = 'verified'`

完整程式碼見 `T7_SKILL_REGISTRY.md` Step 3。

---

## 驗收

```bash
bun run build
# create → draft
# verify → verified
# update → version+1, new row
# deprecate → deprecated
# getAvailable → only verified + (global | same village)
```
