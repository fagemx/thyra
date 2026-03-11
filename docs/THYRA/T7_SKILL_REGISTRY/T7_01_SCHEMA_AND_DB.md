# T7_01: Schema + DB Table

> **Layer**: L1
> **Dependencies**: T1_02（DB Layer）
> **Blocks**: T7_02
> **Output**: `src/schemas/skill.ts`, skills table 加入 initSchema

---

## 給 Agent 的起始指令

```bash
cat docs/THYRA/CONTRACT.md             # THY-13, THY-14
cat docs/THYRA/T7_SKILL_REGISTRY.md    # Step 1, Step 2
cat src/db.ts                          # initSchema，加 skills table
bun run build
```

---

## 實作

### DB table

```sql
CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK(status IN ('draft','verified','deprecated')),
  village_id TEXT REFERENCES villages(id),  -- NULL = global
  definition TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  verified_at TEXT,
  verified_by TEXT,
  UNIQUE(name, version, village_id)
);

CREATE INDEX IF NOT EXISTS idx_skill_village ON skills(village_id, status);
CREATE INDEX IF NOT EXISTS idx_skill_name ON skills(name, version);
```

### src/schemas/skill.ts

```typescript
const SkillDefinitionInput = z.object({
  description: z.string().min(1),
  prompt_template: z.string().min(1),
  tools_required: z.array(z.string()).default([]),
  input_schema: z.record(z.unknown()).optional(),
  output_schema: z.record(z.unknown()).optional(),
  constraints: z.array(z.string()).default([]),
  examples: z.array(z.object({
    input: z.string(),
    expected_output: z.string(),
    explanation: z.string().optional(),
  })).default([]),
});

const CreateSkillInput = z.object({
  name: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  village_id: z.string().optional(),
  definition: SkillDefinitionInput,
});

const UpdateSkillInput = z.object({
  definition: SkillDefinitionInput.partial().optional(),
});
```

完整程式碼見 `T7_SKILL_REGISTRY.md` Step 2。

---

## 驗收

```bash
bun run build
# skills table 存在
# UNIQUE(name, version, village_id) 約束生效
# CreateSkillInput / UpdateSkillInput 可 import
```
