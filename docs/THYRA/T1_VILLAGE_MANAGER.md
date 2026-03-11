# T1: Village Manager

> Batch 1（最先完成）
> 新建檔案：`src/village-manager.ts`, `src/db.ts`, `src/schemas/village.ts`
> 預估：4-5 小時

---

## 開始前

```bash
# Step 1: 讀契約（必讀）
cat docs/plans/THYRA/CONTRACT.md

# Step 2: 確認 TypeScript 環境
bun --version || npx tsc --version

# Step 3: 讀本文件，執行下方步驟
```

---

## 最終結果

- Village CRUD 完整可用（create / read / update / archive / list）
- Zod schema 驗證所有輸入
- SQLite 儲存（dev 用檔案，test 用 :memory:）
- Audit log 每次變更都寫入
- API routes 掛載在 `/api/villages`
- 測試通過：`bun test src/village-manager.test.ts`

---

## 實作步驟

### Step 1: 專案初始化

```bash
mkdir -p src/schemas src/routes tests
bun init
bun add hono zod better-sqlite3
bun add -d typescript @types/better-sqlite3 vitest
```

**tsconfig.json 關鍵設定**：
```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

### Step 2: Database Layer

新建 `src/db.ts`：

```typescript
import Database from 'better-sqlite3';
import path from 'path';

export function createDb(dbPath?: string): Database.Database {
  const db = new Database(dbPath ?? path.join(process.cwd(), 'thyra.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

export function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS villages (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      target_repo TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
        CHECK(status IN ('active','paused','archived')),
      metadata TEXT NOT NULL DEFAULT '{}',
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      payload TEXT NOT NULL,
      actor TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_audit_entity
      ON audit_log(entity_type, entity_id);
  `);
}
```

### Step 3: Village Schema (Zod)

新建 `src/schemas/village.ts`：

```typescript
import { z } from 'zod';

export const CreateVillageInput = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(1000).default(''),
  target_repo: z.string().min(1),
  metadata: z.record(z.unknown()).default({}),
});

export const UpdateVillageInput = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).optional(),
  target_repo: z.string().min(1).optional(),
  status: z.enum(['active', 'paused', 'archived']).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type CreateVillageInput = z.infer<typeof CreateVillageInput>;
export type UpdateVillageInput = z.infer<typeof UpdateVillageInput>;
```

### Step 4: Village Manager 核心邏輯

新建 `src/village-manager.ts`：

```typescript
import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { CreateVillageInput, UpdateVillageInput } from './schemas/village';

export interface Village {
  id: string;
  name: string;
  description: string;
  target_repo: string;
  status: 'active' | 'paused' | 'archived';
  metadata: Record<string, unknown>;
  version: number;
  created_at: string;
  updated_at: string;
}

export class VillageManager {
  constructor(private db: Database.Database) {}

  create(input: CreateVillageInput, actor: string): Village {
    const now = new Date().toISOString();
    const village: Village = {
      id: `village-${randomUUID()}`,
      name: input.name,
      description: input.description ?? '',
      target_repo: input.target_repo,
      status: 'active',
      metadata: input.metadata ?? {},
      version: 1,
      created_at: now,
      updated_at: now,
    };

    this.db.prepare(`
      INSERT INTO villages (id, name, description, target_repo, status, metadata, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      village.id, village.name, village.description, village.target_repo,
      village.status, JSON.stringify(village.metadata), village.version,
      village.created_at, village.updated_at
    );

    this.audit('village', village.id, 'create', village, actor);
    return village;
  }

  get(id: string): Village | null {
    const row = this.db.prepare('SELECT * FROM villages WHERE id = ?').get(id);
    return row ? this.deserialize(row) : null;
  }

  list(filters?: { status?: string }): Village[] {
    let sql = 'SELECT * FROM villages';
    const params: unknown[] = [];
    if (filters?.status) {
      sql += ' WHERE status = ?';
      params.push(filters.status);
    }
    sql += ' ORDER BY created_at DESC';
    return this.db.prepare(sql).all(...params).map(this.deserialize);
  }

  update(id: string, input: UpdateVillageInput, actor: string): Village {
    const existing = this.get(id);
    if (!existing) throw new Error('Village not found');

    const now = new Date().toISOString();
    const updated = {
      ...existing,
      ...Object.fromEntries(Object.entries(input).filter(([_, v]) => v !== undefined)),
      version: existing.version + 1,
      updated_at: now,
    };

    this.db.prepare(`
      UPDATE villages SET name=?, description=?, target_repo=?, status=?,
        metadata=?, version=?, updated_at=? WHERE id=?
    `).run(
      updated.name, updated.description, updated.target_repo, updated.status,
      JSON.stringify(updated.metadata), updated.version, updated.updated_at, id
    );

    this.audit('village', id, 'update', { before: existing, after: updated }, actor);
    return updated;
  }

  archive(id: string, actor: string): void {
    this.update(id, { status: 'archived' }, actor);
  }

  private deserialize(row: any): Village {
    return {
      ...row,
      metadata: JSON.parse(row.metadata || '{}'),
    };
  }

  private audit(entityType: string, entityId: string, action: string, payload: unknown, actor: string) {
    this.db.prepare(`
      INSERT INTO audit_log (entity_type, entity_id, action, payload, actor, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(entityType, entityId, action, JSON.stringify(payload), actor, new Date().toISOString());
  }
}
```

### Step 5: API Routes

新建 `src/routes/villages.ts`：

```typescript
import { Hono } from 'hono';
import { CreateVillageInput, UpdateVillageInput } from '../schemas/village';
import type { VillageManager } from '../village-manager';

export function villageRoutes(mgr: VillageManager) {
  const app = new Hono();

  app.get('/api/villages', (c) => {
    const status = c.req.query('status');
    const villages = mgr.list(status ? { status } : undefined);
    return c.json({ ok: true, data: villages });
  });

  app.post('/api/villages', async (c) => {
    const body = await c.req.json();
    const parsed = CreateVillageInput.safeParse(body);
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: parsed.error.message } }, 400);
    }
    const village = mgr.create(parsed.data, 'human');
    return c.json({ ok: true, data: village }, 201);
  });

  app.get('/api/villages/:id', (c) => {
    const village = mgr.get(c.req.param('id'));
    if (!village) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Village not found' } }, 404);
    return c.json({ ok: true, data: village });
  });

  app.patch('/api/villages/:id', async (c) => {
    const body = await c.req.json();
    const parsed = UpdateVillageInput.safeParse(body);
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: parsed.error.message } }, 400);
    }
    const village = mgr.update(c.req.param('id'), parsed.data, 'human');
    return c.json({ ok: true, data: village });
  });

  app.delete('/api/villages/:id', (c) => {
    mgr.archive(c.req.param('id'), 'human');
    return c.json({ ok: true, data: null });
  });

  return app;
}
```

### Step 6: 測試

`src/village-manager.test.ts`：

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, initSchema } from './db';
import { VillageManager } from './village-manager';

describe('VillageManager', () => {
  let mgr: VillageManager;

  beforeEach(() => {
    const db = createDb(':memory:');
    initSchema(db);
    mgr = new VillageManager(db);
  });

  it('creates and retrieves a village', () => {
    const v = mgr.create({ name: 'test', target_repo: 'fagemx/test' }, 'user1');
    expect(v.id).toMatch(/^village-/);
    expect(v.version).toBe(1);
    const got = mgr.get(v.id);
    expect(got?.name).toBe('test');
  });

  it('updates village and increments version', () => {
    const v = mgr.create({ name: 'old', target_repo: 'repo' }, 'user1');
    const updated = mgr.update(v.id, { name: 'new' }, 'user1');
    expect(updated.version).toBe(2);
    expect(updated.name).toBe('new');
  });

  it('archives village', () => {
    const v = mgr.create({ name: 'test', target_repo: 'repo' }, 'user1');
    mgr.archive(v.id, 'user1');
    expect(mgr.get(v.id)?.status).toBe('archived');
  });

  it('lists with status filter', () => {
    mgr.create({ name: 'a', target_repo: 'r1' }, 'u');
    const b = mgr.create({ name: 'b', target_repo: 'r2' }, 'u');
    mgr.archive(b.id, 'u');
    expect(mgr.list({ status: 'active' })).toHaveLength(1);
  });

  it('rejects invalid input', () => {
    expect(() => mgr.create({ name: '', target_repo: 'r' } as any, 'u')).toThrow();
  });
});
```

---

## 驗收條件

```bash
# Syntax check
bun run build  # 或 npx tsc --noEmit

# 測試
bun test src/village-manager.test.ts

# API 測試
bun run dev &
curl -s http://localhost:3462/api/villages | jq '.ok'  # true
curl -s -X POST http://localhost:3462/api/villages \
  -H "Content-Type: application/json" \
  -d '{"name":"test-village","target_repo":"fagemx/test"}' | jq '.data.id'  # village-xxx
```
