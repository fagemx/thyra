# T7: Skill Registry

> Batch 1（骨架可與 T1 並行）
> 新建檔案：`src/skill-registry.ts`
> 依賴：T1 (Village Manager)，但骨架可先建
> 預估：5-6 小時

---

## 開始前

```bash
cat docs/plans/THYRA/CONTRACT.md   # 特別注意 THY-13, THY-14
```

---

## 最終結果

- Skill CRUD：create / get / list / update / verify / deprecate
- 版本管理：每次 update version +1，舊版不影響已綁定的 Chief
- 驗證流程：draft → verified（人類確認 skill 可用）→ deprecated
- Chief 只能 bind verified skill（THY-14）
- Skill 可以是 Village-scoped 或 global
- Skill 定義包含 prompt template + tools + constraints
- 測試通過

---

## 核心設計

### Skill = Agent 能力的最小可重用單元

不是「一段 prompt」，而是**完整的能力描述**：

```typescript
{
  name: "code-review",
  definition: {
    description: "Review code changes for quality, security, and maintainability",
    prompt_template: `Review the following changes:
{changes}

Focus on:
- Logic correctness
- Security vulnerabilities (OWASP top 10)
- Performance implications
- Test coverage

{constraints}`,
    tools_required: ["gh", "git"],
    input_schema: { changes: "string", constraints: "string?" },
    output_schema: {
      verdict: "'approve' | 'request_changes'",
      findings: "Finding[]",
      severity: "'clean' | 'minor' | 'major' | 'critical'"
    },
    constraints: [
      "Must cite specific file:line for each finding",
      "Must not comment on formatting (handled by linter)"
    ],
    examples: [
      {
        input: "Add null check to user.name",
        expected_output: "approve: defensive check, low risk",
      }
    ]
  }
}
```

### Skill 版本策略

```
Skill v1 → Chief A 綁定 v1
Skill v2 發布（breaking change）
  → Chief A 仍然用 v1（不自動升級）
  → 人類手動把 Chief A 升級到 v2
  → 或建新 Chief B 直接用 v2
```

版本不自動升級是 by design：agent 行為變更需要可控。

### Skill 共享模型

```
Village-scoped skill:
  只有建立它的 Village 可用

Global skill (village_id = null):
  所有 Village 可用
  → Phase 0: 只有 global 或 per-village
  → Phase 2: Territory 層級共享
```

---

## 實作步驟

### Step 1: Database Schema

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

### Step 2: Zod Schema

`src/schemas/skill.ts`：

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
  village_id: z.string().optional(),  // omit = global
  definition: SkillDefinitionInput,
});

const UpdateSkillInput = z.object({
  definition: SkillDefinitionInput.partial().optional(),
  // name 和 village_id 不可改（建新版）
});
```

### Step 3: Skill Registry 核心邏輯

- `create(input, actor): Skill` — 新建 skill（status: draft）
- `get(id): Skill | null`
- `getByNameVersion(name, version, villageId?): Skill | null`
- `list(filters?): Skill[]` — 篩選 village / status / name
- `update(id, input, actor): Skill` — version +1，舊版保留
- `verify(id, actor): Skill` — status → verified，記錄驗證人
- `deprecate(id, actor): Skill` — status → deprecated
- `getAvailable(villageId): Skill[]` — 該 Village 可用的 skills（village-scoped + global，只含 verified）

### Step 4: Chief ↔ Skill 綁定驗證

```typescript
// 供 Chief Engine 呼叫
export function validateSkillBindings(
  bindings: SkillBinding[],
  villageId: string,
  registry: SkillRegistry
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  for (const b of bindings) {
    const skill = registry.get(b.skill_id);
    if (!skill) {
      errors.push(`Skill ${b.skill_id} not found`);
      continue;
    }
    if (skill.status !== 'verified') {
      errors.push(`Skill ${skill.name} is ${skill.status}, must be verified (THY-14)`);
    }
    if (skill.village_id && skill.village_id !== villageId) {
      errors.push(`Skill ${skill.name} belongs to another village`);
    }
    if (b.skill_version !== skill.version) {
      // 允許綁定舊版（by design），但 warn
    }
  }
  return { valid: errors.length === 0, errors };
}
```

### Step 5: Prompt 組合

```typescript
/**
 * 把 Chief 綁定的所有 Skills 組合成完整的 system prompt
 */
export function buildSkillPrompt(bindings: SkillBinding[], registry: SkillRegistry): string {
  const sections: string[] = [];
  for (const b of bindings) {
    const skill = registry.get(b.skill_id);
    if (!skill) continue;
    sections.push(`## Skill: ${skill.name} (v${b.skill_version})`);
    sections.push(skill.definition.prompt_template);
    if (skill.definition.constraints.length) {
      sections.push('Constraints:');
      sections.push(skill.definition.constraints.map(c => `- ${c}`).join('\n'));
    }
  }
  return sections.join('\n\n');
}
```

### Step 6: API Routes

```
GET    /api/skills                        # 全域列表
POST   /api/skills                        # 建立
GET    /api/skills/:id
PATCH  /api/skills/:id                    # 更新（version +1）
POST   /api/skills/:id/verify             # 驗證
POST   /api/skills/:id/deprecate          # 棄用
GET    /api/villages/:vid/skills           # 該 Village 可用的 skills
```

### Step 7: 預設 Skills（種子資料）

Phase 0 內建幾個常用 skill，status = verified：

| Skill | 說明 |
|-------|------|
| `code-review` | PR 品質審查 |
| `security-audit` | 安全漏洞檢查 |
| `test-writer` | 自動寫測試 |
| `refactoring` | 程式碼重構 |
| `system-design` | 架構設計 |
| `incident-response` | 事故回應 |

### Step 8: 測試

- 建立 skill → draft
- verify → verified
- Chief bind verified skill → 成功
- Chief bind draft skill → 報錯（THY-14）
- 更新 skill → version +1，舊版保留
- deprecate → 新 Chief 不能 bind，已 bind 的不受影響
- getAvailable → 只回 verified + (global | same village)

---

## 驗收條件

```bash
bun test src/skill-registry.test.ts

# THY-14 驗證
# 1. 建 draft skill
# 2. 嘗試 bind 到 Chief
# 3. 預期：400 SKILL_NOT_VERIFIED
```
