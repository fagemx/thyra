# T3_01: Schema + DB Table

> **Layer**: L2
> **Dependencies**: T1_02, T2_01（PermissionEnum）
> **Blocks**: T3_02
> **Output**: `src/schemas/chief.ts`, chiefs table 加入 initSchema

---

## 給 Agent 的起始指令

```bash
cat docs/THYRA/CONTRACT.md             # THY-09, THY-14
cat docs/THYRA/T3_CHIEF_ENGINE.md      # Step 1, Step 2
cat src/schemas/constitution.ts        # import PermissionEnum
bun run build
```

---

## 實作

### DB table

```sql
CREATE TABLE IF NOT EXISTS chiefs (
  id TEXT PRIMARY KEY,
  village_id TEXT NOT NULL REFERENCES villages(id),
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  skills TEXT NOT NULL DEFAULT '[]',
  permissions TEXT NOT NULL DEFAULT '[]',
  personality TEXT NOT NULL DEFAULT '{}',
  constraints TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chief_village ON chiefs(village_id, status);
```

### src/schemas/chief.ts

定義 `SkillBindingInput`、`ChiefPersonalityInput`、`ChiefConstraintInput`、`CreateChiefInput`、`UpdateChiefInput`。

完整程式碼見 `T3_CHIEF_ENGINE.md` Step 2。

---

## 驗收

```bash
bun run build
# chiefs table 存在
```
