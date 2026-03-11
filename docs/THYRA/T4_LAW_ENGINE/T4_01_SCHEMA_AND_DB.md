# T4_01: Schema + DB Table

> **Layer**: L2
> **Dependencies**: T1_02（DB Layer）, T2_01（PermissionEnum）
> **Blocks**: T4_02, T4_03
> **Output**: `src/schemas/law.ts`, laws table 加入 initSchema

---

## 給 Agent 的起始指令

```bash
cat docs/THYRA/CONTRACT.md             # THY-02, THY-03
cat docs/THYRA/T4_LAW_ENGINE.md        # Step 1, Step 2
cat src/db.ts                          # initSchema，加 laws table
bun run build
```

---

## 實作

### DB table

```sql
CREATE TABLE IF NOT EXISTS laws (
  id TEXT PRIMARY KEY,
  village_id TEXT NOT NULL REFERENCES villages(id),
  proposed_by TEXT NOT NULL,
  approved_by TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK(status IN ('proposed','active','revoked','rolled_back','rejected')),
  category TEXT NOT NULL,
  content TEXT NOT NULL,
  risk_level TEXT NOT NULL CHECK(risk_level IN ('low','medium','high')),
  evidence TEXT NOT NULL DEFAULT '{}',
  effectiveness TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_law_village ON laws(village_id, status);
CREATE INDEX IF NOT EXISTS idx_law_category ON laws(village_id, category);
```

### src/schemas/law.ts

定義 `ProposeLawInput`（category + content + evidence）、`EvaluateLawInput`（metrics + verdict）。

完整程式碼見 `T4_LAW_ENGINE.md` Step 2。

---

## 驗收

```bash
bun run build
# laws table 存在
# ProposeLawInput / EvaluateLawInput 型別可 import
```
