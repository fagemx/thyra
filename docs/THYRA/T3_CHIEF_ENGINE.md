# T3: Chief Engine

> Batch 2（可與 T5 並行）
> 新建檔案：`src/chief-engine.ts`, `src/schemas/chief.ts`
> 依賴：T1 (Village Manager), T2 (Constitution Store), T7 (Skill Registry)
> 預估：5-6 小時

---

## 開始前

```bash
cat docs/plans/THYRA/CONTRACT.md
bun test src/village-manager.test.ts
bun test src/constitution-store.test.ts
bun test src/skill-registry.test.ts
```

---

## 最終結果

- Chief CRUD：create / get / list / update / deactivate
- 權限驗證：Chief permissions ⊆ Constitution allowed_permissions（THY-09）
- Skill binding 驗證：只能 bind verified skills（THY-14）
- Chief 人格系統：risk tolerance + communication style + decision speed
- Chief 約束系統：must / must_not / prefer / avoid
- Prompt 生成：buildChiefPrompt → 完整 system prompt
- 測試通過

---

## 核心設計

### Chief = AI Agent 的行為人格

Chief 不是「一個 LLM instance」，而是一組**行為約束 + 技能配置**。同一個 LLM 可以用不同 Chief 設定產生不同行為。

```
Constitution 定義「什麼可以做」
Chief 定義「怎麼做 + 做事風格」
Skill 定義「具體能做什麼」
```

### 權限子集約束（THY-09）

```typescript
function validatePermissions(
  chiefPermissions: Permission[],
  constitutionPermissions: Permission[]
): boolean {
  return chiefPermissions.every(p => constitutionPermissions.includes(p));
}
```

如果 Constitution 被 supersede 且新版收緊了權限，現有 Chief 不自動失效，但下次執行任何超出新 Constitution 的動作時會被 Loop Runner 攔截。

---

## 實作步驟

### Step 1: Database Schema

```sql
CREATE TABLE IF NOT EXISTS chiefs (
  id TEXT PRIMARY KEY,
  village_id TEXT NOT NULL REFERENCES villages(id),
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK(status IN ('active','inactive')),
  skills TEXT NOT NULL DEFAULT '[]',
  permissions TEXT NOT NULL DEFAULT '[]',
  personality TEXT NOT NULL DEFAULT '{}',
  constraints TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chief_village ON chiefs(village_id, status);
```

### Step 2: Zod Schema

新建 `src/schemas/chief.ts`：

```typescript
import { z } from 'zod';
import { PermissionEnum } from './constitution';

const SkillBindingInput = z.object({
  skill_id: z.string(),
  skill_version: z.number().int().positive(),
  config: z.record(z.unknown()).optional(),
});

const ChiefPersonalityInput = z.object({
  risk_tolerance: z.enum(['conservative', 'moderate', 'aggressive']).default('moderate'),
  communication_style: z.enum(['concise', 'detailed', 'minimal']).default('concise'),
  decision_speed: z.enum(['fast', 'deliberate', 'cautious']).default('deliberate'),
});

const ChiefConstraintInput = z.object({
  type: z.enum(['must', 'must_not', 'prefer', 'avoid']),
  description: z.string().min(1),
});

export const CreateChiefInput = z.object({
  name: z.string().min(1).max(100),
  role: z.string().min(1).max(500),
  skills: z.array(SkillBindingInput).default([]),
  permissions: z.array(PermissionEnum).default([]),
  personality: ChiefPersonalityInput.default({}),
  constraints: z.array(ChiefConstraintInput).default([]),
});

export const UpdateChiefInput = z.object({
  name: z.string().min(1).max(100).optional(),
  role: z.string().min(1).max(500).optional(),
  skills: z.array(SkillBindingInput).optional(),
  permissions: z.array(PermissionEnum).optional(),
  personality: ChiefPersonalityInput.optional(),
  constraints: z.array(ChiefConstraintInput).optional(),
});

export type CreateChiefInput = z.infer<typeof CreateChiefInput>;
export type UpdateChiefInput = z.infer<typeof UpdateChiefInput>;
```

### Step 3: Chief Engine 核心邏輯

新建 `src/chief-engine.ts`：

```typescript
import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type { CreateChiefInput, UpdateChiefInput } from './schemas/chief';
import type { ConstitutionStore } from './constitution-store';
import type { SkillRegistry } from './skill-registry';
import type { Permission } from './schemas/constitution';

export interface Chief {
  id: string;
  village_id: string;
  name: string;
  role: string;
  version: number;
  status: 'active' | 'inactive';
  skills: SkillBinding[];
  permissions: Permission[];
  personality: ChiefPersonality;
  constraints: ChiefConstraint[];
  created_at: string;
  updated_at: string;
}

export interface SkillBinding {
  skill_id: string;
  skill_version: number;
  config?: Record<string, unknown>;
}

export interface ChiefPersonality {
  risk_tolerance: 'conservative' | 'moderate' | 'aggressive';
  communication_style: 'concise' | 'detailed' | 'minimal';
  decision_speed: 'fast' | 'deliberate' | 'cautious';
}

export interface ChiefConstraint {
  type: 'must' | 'must_not' | 'prefer' | 'avoid';
  description: string;
}

export class ChiefEngine {
  constructor(
    private db: Database.Database,
    private constitutionStore: ConstitutionStore,
    private skillRegistry: SkillRegistry,
  ) {}

  create(villageId: string, input: CreateChiefInput, actor: string): Chief {
    // 取 active constitution
    const constitution = this.constitutionStore.getActive(villageId);
    if (!constitution) {
      throw new Error('No active constitution. Cannot create Chief without a constitution framework.');
    }

    // 驗證 permissions ⊆ constitution.allowed_permissions（THY-09）
    for (const perm of input.permissions) {
      if (!constitution.allowed_permissions.includes(perm)) {
        throw new Error(`PERMISSION_EXCEEDS_CONSTITUTION: "${perm}" not in constitution's allowed_permissions`);
      }
    }

    // 驗證 skill bindings（THY-14）
    this.validateSkillBindings(input.skills, villageId);

    const now = new Date().toISOString();
    const chief: Chief = {
      id: `chief-${randomUUID()}`,
      village_id: villageId,
      name: input.name,
      role: input.role,
      version: 1,
      status: 'active',
      skills: input.skills,
      permissions: input.permissions,
      personality: input.personality,
      constraints: input.constraints,
      created_at: now,
      updated_at: now,
    };

    this.db.prepare(`
      INSERT INTO chiefs (id, village_id, name, role, version, status, skills, permissions, personality, constraints, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      chief.id, villageId, chief.name, chief.role, chief.version, chief.status,
      JSON.stringify(chief.skills), JSON.stringify(chief.permissions),
      JSON.stringify(chief.personality), JSON.stringify(chief.constraints),
      chief.created_at, chief.updated_at,
    );

    this.audit(chief.id, 'create', chief, actor);
    return chief;
  }

  get(id: string): Chief | null {
    const row = this.db.prepare('SELECT * FROM chiefs WHERE id = ?').get(id) as any;
    return row ? this.deserialize(row) : null;
  }

  list(villageId: string, opts?: { status?: string }): Chief[] {
    let sql = 'SELECT * FROM chiefs WHERE village_id = ?';
    const params: unknown[] = [villageId];
    if (opts?.status) {
      sql += ' AND status = ?';
      params.push(opts.status);
    }
    sql += ' ORDER BY created_at DESC';
    return this.db.prepare(sql).all(...params).map((r: any) => this.deserialize(r));
  }

  update(id: string, input: UpdateChiefInput, actor: string): Chief {
    const existing = this.get(id);
    if (!existing) throw new Error('Chief not found');

    // 如果更新 permissions → 重新驗證子集約束
    if (input.permissions) {
      const constitution = this.constitutionStore.getActive(existing.village_id);
      if (!constitution) throw new Error('No active constitution');
      for (const perm of input.permissions) {
        if (!constitution.allowed_permissions.includes(perm)) {
          throw new Error(`PERMISSION_EXCEEDS_CONSTITUTION: "${perm}"`);
        }
      }
    }

    // 如果更新 skills → 重新驗證 binding
    if (input.skills) {
      this.validateSkillBindings(input.skills, existing.village_id);
    }

    const now = new Date().toISOString();
    const updated: Chief = {
      ...existing,
      ...Object.fromEntries(Object.entries(input).filter(([_, v]) => v !== undefined)),
      version: existing.version + 1,
      updated_at: now,
    } as Chief;

    this.db.prepare(`
      UPDATE chiefs SET name=?, role=?, version=?, skills=?, permissions=?,
        personality=?, constraints=?, updated_at=? WHERE id=?
    `).run(
      updated.name, updated.role, updated.version,
      JSON.stringify(updated.skills), JSON.stringify(updated.permissions),
      JSON.stringify(updated.personality), JSON.stringify(updated.constraints),
      now, id,
    );

    this.audit(id, 'update', { before: existing, after: updated }, actor);
    return updated;
  }

  deactivate(id: string, actor: string): void {
    const chief = this.get(id);
    if (!chief) throw new Error('Chief not found');
    this.db.prepare('UPDATE chiefs SET status = ?, updated_at = ? WHERE id = ?')
      .run('inactive', new Date().toISOString(), id);
    this.audit(id, 'deactivate', { previous_status: chief.status }, actor);
  }

  private validateSkillBindings(bindings: SkillBinding[], villageId: string): void {
    for (const b of bindings) {
      const skill = this.skillRegistry.get(b.skill_id);
      if (!skill) throw new Error(`Skill ${b.skill_id} not found`);
      if (skill.status !== 'verified') {
        throw new Error(`SKILL_NOT_VERIFIED: "${skill.name}" is ${skill.status}, must be verified (THY-14)`);
      }
      if (skill.village_id && skill.village_id !== villageId) {
        throw new Error(`Skill "${skill.name}" belongs to another village`);
      }
    }
  }

  private deserialize(row: any): Chief {
    return {
      ...row,
      skills: JSON.parse(row.skills || '[]'),
      permissions: JSON.parse(row.permissions || '[]'),
      personality: JSON.parse(row.personality || '{}'),
      constraints: JSON.parse(row.constraints || '[]'),
    };
  }

  private audit(entityId: string, action: string, payload: unknown, actor: string) {
    this.db.prepare(`
      INSERT INTO audit_log (entity_type, entity_id, action, payload, actor, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('chief', entityId, action, JSON.stringify(payload), actor, new Date().toISOString());
  }
}
```

### Step 4: Prompt 生成

```typescript
import type { SkillRegistry } from './skill-registry';
import { buildSkillPrompt } from './skill-registry';

/**
 * 把 Chief 的人格 + 約束 + Skills 轉成完整 system prompt
 * 供 Loop Runner 組合使用
 */
export function buildChiefPrompt(chief: Chief, skillRegistry: SkillRegistry): string {
  const lines: string[] = [];

  // 角色
  lines.push(`You are "${chief.name}", a ${chief.role}.`);
  lines.push('');

  // 人格
  const p = chief.personality;
  const personalityMap: Record<string, Record<string, string>> = {
    risk_tolerance: {
      conservative: 'You are risk-averse. When in doubt, choose the safer option.',
      moderate: 'You balance risk and reward. Take calculated risks when evidence supports them.',
      aggressive: 'You are willing to take calculated risks for better outcomes.',
    },
    communication_style: {
      concise: 'Be concise and direct. Lead with conclusions.',
      detailed: 'Provide thorough explanations with evidence.',
      minimal: 'Only communicate essential information.',
    },
    decision_speed: {
      fast: 'Make decisions quickly. Bias toward action.',
      deliberate: 'Take time to consider options. Balance speed with thoroughness.',
      cautious: 'Be thorough and methodical. Double-check before acting.',
    },
  };

  lines.push('## Personality');
  lines.push(personalityMap.risk_tolerance[p.risk_tolerance]);
  lines.push(personalityMap.communication_style[p.communication_style]);
  lines.push(personalityMap.decision_speed[p.decision_speed]);
  lines.push('');

  // 約束
  if (chief.constraints.length > 0) {
    lines.push('## Constraints');
    const prefixMap = {
      must: 'You MUST',
      must_not: 'You MUST NOT',
      prefer: 'You should prefer to',
      avoid: 'You should avoid',
    };
    for (const c of chief.constraints) {
      lines.push(`- ${prefixMap[c.type]}: ${c.description}`);
    }
    lines.push('');
  }

  // Skills
  if (chief.skills.length > 0) {
    const skillPrompt = buildSkillPrompt(chief.skills, skillRegistry);
    if (skillPrompt) {
      lines.push('## Skills');
      lines.push(skillPrompt);
    }
  }

  return lines.join('\n');
}
```

### Step 5: API Routes

```typescript
// GET    /api/villages/:vid/chiefs
// POST   /api/villages/:vid/chiefs
// GET    /api/chiefs/:id
// PATCH  /api/chiefs/:id
// DELETE /api/chiefs/:id              # → deactivate
// GET    /api/chiefs/:id/prompt       # 預覽生成的 prompt

app.get('/api/chiefs/:id/prompt', (c) => {
  const chief = engine.get(c.req.param('id'));
  if (!chief) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404);
  const prompt = buildChiefPrompt(chief, skillRegistry);
  return c.json({ ok: true, data: { prompt } });
});
```

### Step 6: 測試

```typescript
describe('ChiefEngine', () => {
  it('creates chief with permissions subset of constitution', () => {
    // constitution allows [dispatch_task, propose_law]
    // chief requests [dispatch_task] → success
  });

  it('rejects chief with permissions exceeding constitution', () => {
    // constitution allows [dispatch_task]
    // chief requests [deploy] → PERMISSION_EXCEEDS_CONSTITUTION
  });

  it('rejects binding draft skill', () => {
    // skill status = draft
    // chief binds it → SKILL_NOT_VERIFIED
  });

  it('creates chief without constitution → error', () => {
    // no active constitution → error
  });

  it('updates chief personality → version +1', () => {
    // update personality → version increments
  });

  it('deactivate → status inactive', () => {
    // deactivate → chief.status = 'inactive'
  });

  it('buildChiefPrompt includes name, role, personality, constraints, skills', () => {
    // prompt contains all sections
  });

  it('update permissions re-validates against constitution', () => {
    // update with new permission not in constitution → rejected
  });
});
```

---

## 驗收條件

```bash
bun test src/chief-engine.test.ts

# 權限子集驗證
curl -X POST http://localhost:3462/api/villages/xxx/chiefs \
  -d '{"name":"Rogue","role":"test","permissions":["deploy"]}' \
  -H "Content-Type: application/json"
# 預期：如果 constitution 不允許 deploy → 400 PERMISSION_EXCEEDS_CONSTITUTION

# Prompt 預覽
curl -s http://localhost:3462/api/chiefs/xxx/prompt | jq '.data.prompt'
# 預期：包含 name, role, personality, constraints, skills
```
