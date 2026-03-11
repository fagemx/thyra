# T2: Constitution Store

> Batch 1（接在 T1 之後）
> 新建檔案：`src/constitution-store.ts`, `src/schemas/constitution.ts`
> 依賴：T1 (Village Manager)
> 預估：4-5 小時

---

## 開始前

```bash
cat docs/plans/THYRA/CONTRACT.md
# 確認 T1 完成、村莊 CRUD 可用
bun test src/village-manager.test.ts
```

---

## 最終結果

- Constitution CRUD：create / get / list / revoke / supersede
- **不可修改**（CONTRACT THY-01）：沒有 update 方法
- Constitution 包含 rules + permissions + budget limits
- Supersede 機制：作廢舊版 + 建新版，鏈式追溯
- API routes 掛載在 `/api/villages/:id/constitutions`
- 測試通過

---

## 核心設計

### 不可變性保證（THY-01）

Constitution 一旦 status 為 `active`，**只有兩種操作**：
1. `revoke(id)` → status 變 `revoked`，該村莊失去憲法
2. `supersede(id, newConstitution)` → 舊版 status 變 `superseded` + `superseded_by` 指向新版

**沒有 `update()` 方法**。要改規則就建新版。這確保歷史可追溯。

### 權限模型

```typescript
type Permission =
  | 'dispatch_task'       // 派發任務到 Karvi
  | 'propose_law'         // 提議新法律
  | 'enact_law_low'       // 自動頒布低風險法律
  | 'query_edda'          // 查詢 Edda 判例
  | 'modify_chief'        // 修改 Chief 設定
  | 'create_branch'       // 建 git branch
  | 'merge_pr'            // 合併 PR
  | 'deploy'              // 部署
  | 'spend_budget';       // 花錢（受 budget_limits 約束）
```

Chief 的 permissions 必須是 Constitution 的 `allowed_permissions` 的子集（THY-09）。

---

## 實作步驟

### Step 1: Database Schema

在 `src/db.ts` 的 `initSchema` 加入：

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

CREATE INDEX IF NOT EXISTS idx_const_village
  ON constitutions(village_id, status);
```

### Step 2: Zod Schema

新建 `src/schemas/constitution.ts`：

```typescript
import { z } from 'zod';

export const PermissionEnum = z.enum([
  'dispatch_task', 'propose_law', 'enact_law_low',
  'query_edda', 'modify_chief', 'create_branch',
  'merge_pr', 'deploy', 'spend_budget',
]);

const ConstitutionRuleInput = z.object({
  id: z.string().optional(),
  description: z.string().min(1),
  enforcement: z.enum(['hard', 'soft']),
  scope: z.array(z.string()).default(['*']),
});

const BudgetLimitsInput = z.object({
  max_cost_per_action: z.number().min(0).default(10),
  max_cost_per_day: z.number().min(0).default(100),
  max_cost_per_loop: z.number().min(0).default(50),
});

export const CreateConstitutionInput = z.object({
  rules: z.array(ConstitutionRuleInput).min(1),
  allowed_permissions: z.array(PermissionEnum).min(1),
  budget_limits: BudgetLimitsInput.default({}),
});

export type Permission = z.infer<typeof PermissionEnum>;
export type CreateConstitutionInput = z.infer<typeof CreateConstitutionInput>;
```

### Step 3: Constitution Store 核心邏輯

新建 `src/constitution-store.ts`：

```typescript
import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type { CreateConstitutionInput, Permission } from './schemas/constitution';

export interface Constitution {
  id: string;
  village_id: string;
  version: number;
  status: 'active' | 'revoked' | 'superseded';
  created_at: string;
  created_by: string;
  rules: ConstitutionRule[];
  allowed_permissions: Permission[];
  budget_limits: BudgetLimits;
  superseded_by?: string;
}

export interface ConstitutionRule {
  id: string;
  description: string;
  enforcement: 'hard' | 'soft';
  scope: string[];
}

export interface BudgetLimits {
  max_cost_per_action: number;
  max_cost_per_day: number;
  max_cost_per_loop: number;
}

export class ConstitutionStore {
  constructor(private db: Database.Database) {}

  create(villageId: string, input: CreateConstitutionInput, actor: string): Constitution {
    const existing = this.getActive(villageId);
    if (existing) {
      throw new Error('Village already has an active constitution. Use supersede() instead.');
    }

    const now = new Date().toISOString();
    const constitution: Constitution = {
      id: `const-${randomUUID()}`,
      village_id: villageId,
      version: 1,
      status: 'active',
      created_at: now,
      created_by: actor,
      rules: input.rules.map((r, i) => ({ ...r, id: r.id ?? `rule-${i + 1}` })),
      allowed_permissions: input.allowed_permissions,
      budget_limits: input.budget_limits,
    };

    this.db.prepare(`
      INSERT INTO constitutions
        (id, village_id, version, status, created_at, created_by, rules, allowed_permissions, budget_limits)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      constitution.id, villageId, constitution.version, constitution.status,
      now, actor,
      JSON.stringify(constitution.rules),
      JSON.stringify(constitution.allowed_permissions),
      JSON.stringify(constitution.budget_limits),
    );

    this.audit(constitution.id, 'create', constitution, actor);
    return constitution;
  }

  get(id: string): Constitution | null {
    const row = this.db.prepare('SELECT * FROM constitutions WHERE id = ?').get(id) as any;
    return row ? this.deserialize(row) : null;
  }

  getActive(villageId: string): Constitution | null {
    const row = this.db.prepare(
      'SELECT * FROM constitutions WHERE village_id = ? AND status = ? ORDER BY version DESC LIMIT 1'
    ).get(villageId, 'active') as any;
    return row ? this.deserialize(row) : null;
  }

  list(villageId: string): Constitution[] {
    return this.db.prepare(
      'SELECT * FROM constitutions WHERE village_id = ? ORDER BY version DESC'
    ).all(villageId).map((r: any) => this.deserialize(r));
  }

  revoke(id: string, actor: string): void {
    const c = this.get(id);
    if (!c || c.status !== 'active') throw new Error('Constitution not found or not active');
    this.db.prepare('UPDATE constitutions SET status = ? WHERE id = ?').run('revoked', id);
    this.audit(id, 'revoke', { previous_status: c.status }, actor);
  }

  supersede(id: string, newInput: CreateConstitutionInput, actor: string): Constitution {
    const old = this.get(id);
    if (!old || old.status !== 'active') throw new Error('Constitution not found or not active');

    const now = new Date().toISOString();
    const newConstitution: Constitution = {
      id: `const-${randomUUID()}`,
      village_id: old.village_id,
      version: old.version + 1,
      status: 'active',
      created_at: now,
      created_by: actor,
      rules: newInput.rules.map((r, i) => ({ ...r, id: r.id ?? `rule-${i + 1}` })),
      allowed_permissions: newInput.allowed_permissions,
      budget_limits: newInput.budget_limits,
    };

    this.db.transaction(() => {
      this.db.prepare(
        'UPDATE constitutions SET status = ?, superseded_by = ? WHERE id = ?'
      ).run('superseded', newConstitution.id, id);

      this.db.prepare(`
        INSERT INTO constitutions
          (id, village_id, version, status, created_at, created_by, rules, allowed_permissions, budget_limits)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        newConstitution.id, newConstitution.village_id, newConstitution.version,
        newConstitution.status, now, actor,
        JSON.stringify(newConstitution.rules),
        JSON.stringify(newConstitution.allowed_permissions),
        JSON.stringify(newConstitution.budget_limits),
      );
    })();

    this.audit(id, 'supersede', { old_id: id, new_id: newConstitution.id, new_version: newConstitution.version }, actor);
    return newConstitution;
  }

  private deserialize(row: any): Constitution {
    return {
      ...row,
      rules: JSON.parse(row.rules || '[]'),
      allowed_permissions: JSON.parse(row.allowed_permissions || '[]'),
      budget_limits: JSON.parse(row.budget_limits || '{}'),
    };
  }

  private audit(entityId: string, action: string, payload: unknown, actor: string) {
    this.db.prepare(`
      INSERT INTO audit_log (entity_type, entity_id, action, payload, actor, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('constitution', entityId, action, JSON.stringify(payload), actor, new Date().toISOString());
  }
}
```

### Step 4: Constitution 驗證工具

```typescript
// 供 T3 Chief Engine、T4 Law Engine、T5 Risk Assessor 使用
// 放在 constitution-store.ts 底部 export

export function checkPermission(
  constitution: Constitution,
  permission: Permission
): boolean {
  return constitution.allowed_permissions.includes(permission);
}

export function checkBudget(
  constitution: Constitution,
  amount: number,
  type: 'per_action' | 'per_day' | 'per_loop'
): boolean {
  const limits: Record<string, number> = {
    per_action: constitution.budget_limits.max_cost_per_action,
    per_day: constitution.budget_limits.max_cost_per_day,
    per_loop: constitution.budget_limits.max_cost_per_loop,
  };
  return amount <= limits[type];
}

export function checkRules(
  constitution: Constitution,
  chiefId: string,
  actionDescription: string
): { allowed: boolean; violated: ConstitutionRule[] } {
  const violated: ConstitutionRule[] = [];
  for (const rule of constitution.rules) {
    const inScope = rule.scope.includes('*') || rule.scope.includes(chiefId);
    if (!inScope) continue;
    // 規則匹配邏輯由上層（Law Engine / Risk Assessor）負責
    // 這裡提供遍歷 framework，具體 match 在 T4/T5 實作
  }
  return { allowed: violated.length === 0, violated };
}
```

### Step 5: API Routes

新建 `src/routes/constitutions.ts`：

```typescript
import { Hono } from 'hono';
import { CreateConstitutionInput } from '../schemas/constitution';
import type { ConstitutionStore } from '../constitution-store';

export function constitutionRoutes(store: ConstitutionStore) {
  const app = new Hono();

  // 列表（含歷史版本）
  app.get('/api/villages/:vid/constitutions', (c) => {
    const list = store.list(c.req.param('vid'));
    return c.json({ ok: true, data: list });
  });

  // 建立（首次）
  app.post('/api/villages/:vid/constitutions', async (c) => {
    const body = await c.req.json();
    const parsed = CreateConstitutionInput.safeParse(body);
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: parsed.error.message } }, 400);
    }
    const constitution = store.create(c.req.param('vid'), parsed.data, 'human');
    return c.json({ ok: true, data: constitution }, 201);
  });

  // 當前有效
  app.get('/api/villages/:vid/constitutions/active', (c) => {
    const active = store.getActive(c.req.param('vid'));
    if (!active) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'No active constitution' } }, 404);
    return c.json({ ok: true, data: active });
  });

  // 按 id 讀
  app.get('/api/constitutions/:id', (c) => {
    const constitution = store.get(c.req.param('id'));
    if (!constitution) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
    return c.json({ ok: true, data: constitution });
  });

  // 作廢
  app.post('/api/constitutions/:id/revoke', (c) => {
    store.revoke(c.req.param('id'), 'human');
    return c.json({ ok: true, data: null });
  });

  // 升級（supersede）
  app.post('/api/constitutions/:id/supersede', async (c) => {
    const body = await c.req.json();
    const parsed = CreateConstitutionInput.safeParse(body);
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: parsed.error.message } }, 400);
    }
    const newConstitution = store.supersede(c.req.param('id'), parsed.data, 'human');
    return c.json({ ok: true, data: newConstitution }, 201);
  });

  // 注意：沒有 PATCH — 不可修改（THY-01）

  return app;
}
```

### Step 6: 測試

```typescript
describe('ConstitutionStore', () => {
  let store: ConstitutionStore;
  let villageId: string;

  beforeEach(() => {
    const db = createDb(':memory:');
    initSchema(db);
    const mgr = new VillageManager(db);
    const v = mgr.create({ name: 'test', target_repo: 'r' }, 'u');
    villageId = v.id;
    store = new ConstitutionStore(db);
  });

  it('creates constitution for village', () => {
    const c = store.create(villageId, {
      rules: [{ description: 'must review', enforcement: 'hard', scope: ['*'] }],
      allowed_permissions: ['dispatch_task', 'propose_law'],
      budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
    }, 'human');
    expect(c.id).toMatch(/^const-/);
    expect(c.version).toBe(1);
    expect(c.status).toBe('active');
  });

  it('rejects create when active constitution exists', () => {
    store.create(villageId, { rules: [{ description: 'r1', enforcement: 'hard' }], allowed_permissions: ['dispatch_task'] }, 'h');
    expect(() => store.create(villageId, { rules: [{ description: 'r2', enforcement: 'hard' }], allowed_permissions: ['deploy'] }, 'h'))
      .toThrow('already has');
  });

  it('supersede: old superseded, new active, version +1', () => {
    const v1 = store.create(villageId, { rules: [{ description: 'r1', enforcement: 'hard' }], allowed_permissions: ['dispatch_task'] }, 'h');
    const v2 = store.supersede(v1.id, { rules: [{ description: 'r2', enforcement: 'soft' }], allowed_permissions: ['dispatch_task', 'deploy'] }, 'h');
    expect(v2.version).toBe(2);
    expect(store.get(v1.id)?.status).toBe('superseded');
    expect(store.getActive(villageId)?.id).toBe(v2.id);
  });

  it('revoke: status → revoked', () => {
    const c = store.create(villageId, { rules: [{ description: 'r', enforcement: 'hard' }], allowed_permissions: ['dispatch_task'] }, 'h');
    store.revoke(c.id, 'h');
    expect(store.get(c.id)?.status).toBe('revoked');
    expect(store.getActive(villageId)).toBeNull();
  });

  it('checkPermission works correctly', () => {
    const c = store.create(villageId, { rules: [{ description: 'r', enforcement: 'hard' }], allowed_permissions: ['dispatch_task'] }, 'h');
    expect(checkPermission(c, 'dispatch_task')).toBe(true);
    expect(checkPermission(c, 'deploy')).toBe(false);
  });

  it('checkBudget: over limit returns false', () => {
    const c = store.create(villageId, {
      rules: [{ description: 'r', enforcement: 'hard' }],
      allowed_permissions: ['dispatch_task'],
      budget_limits: { max_cost_per_action: 5, max_cost_per_day: 50, max_cost_per_loop: 25 },
    }, 'h');
    expect(checkBudget(c, 3, 'per_action')).toBe(true);
    expect(checkBudget(c, 10, 'per_action')).toBe(false);
  });

  it('list returns all versions descending', () => {
    const v1 = store.create(villageId, { rules: [{ description: 'r', enforcement: 'hard' }], allowed_permissions: ['dispatch_task'] }, 'h');
    store.supersede(v1.id, { rules: [{ description: 'r2', enforcement: 'hard' }], allowed_permissions: ['dispatch_task'] }, 'h');
    const list = store.list(villageId);
    expect(list).toHaveLength(2);
    expect(list[0].version).toBe(2);
    expect(list[1].version).toBe(1);
  });
});
```

---

## 驗收條件

```bash
bun test src/constitution-store.test.ts

# 手動驗證不可變性
curl -X PATCH http://localhost:3462/api/constitutions/xxx \
  -H "Content-Type: application/json" \
  -d '{"rules": []}'
# 預期：404 或 405 Method Not Allowed
```
