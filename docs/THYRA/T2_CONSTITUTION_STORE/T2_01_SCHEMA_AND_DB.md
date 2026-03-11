# T2_01: Schema + DB Table

> **Layer**: L1
> **Dependencies**: T1_02（db.ts 存在）
> **Blocks**: T2_02
> **Output**: `src/schemas/constitution.ts`, constitutions table 加入 initSchema

---

## 給 Agent 的起始指令

```bash
cat docs/THYRA/CONTRACT.md             # THY-01(不可變), THY-09(permissions子集)
cat docs/THYRA/TRACKS.md               # import path
cat src/db.ts                          # 確認 initSchema 結構
bun run build
```

---

## 實作

### src/schemas/constitution.ts

定義 `PermissionEnum`、`ConstitutionRuleInput`、`BudgetLimitsInput`、`CreateConstitutionInput`。

完整程式碼見 `T2_CONSTITUTION_STORE.md` Step 2。

### DB table（加入 src/db.ts initSchema）

```sql
CREATE TABLE IF NOT EXISTS constitutions (
  id TEXT PRIMARY KEY,
  village_id TEXT NOT NULL REFERENCES villages(id),
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK(status IN ('active','revoked','superseded')),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  rules TEXT NOT NULL DEFAULT '[]',
  allowed_permissions TEXT NOT NULL DEFAULT '[]',
  budget_limits TEXT NOT NULL DEFAULT '{}',
  superseded_by TEXT,
  UNIQUE(village_id, version)
);
CREATE INDEX IF NOT EXISTS idx_const_village ON constitutions(village_id, status);
```

---

## 驗收

```bash
bun run build
bun -e "import{createDb,initSchema}from'./src/db';const db=createDb(':memory:');initSchema(db);console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE type='table'\").all().map(t=>t.name))"
# 預期包含: villages, constitutions, audit_log
```
