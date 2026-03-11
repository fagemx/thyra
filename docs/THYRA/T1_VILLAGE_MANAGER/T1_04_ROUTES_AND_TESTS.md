# T1_04: Routes + Tests

> **Layer**: L0
> **Dependencies**: T1_03（VillageManager class）
> **Blocks**: 無（T1 完成）
> **Output**: `src/routes/villages.ts`, `src/village-manager.test.ts`

---

## 給 Agent 的起始指令

```bash
cat docs/THYRA/CONTRACT.md             # THY-11（統一回應格式）
cat docs/THYRA/TRACKS.md               # route path: src/routes/villages.ts
cat src/village-manager.ts             # 確認 T1_03 完成
bun run build                          # 基線通過
```

---

## 最終結果

```
src/
  routes/villages.ts         # Hono routes: GET/POST/PATCH/DELETE /api/villages
  village-manager.test.ts    # 完整測試
```

API 冒煙測試通過，`bun test` 通過。

---

## 實作

### src/routes/villages.ts

```typescript
import { Hono } from 'hono';
import { CreateVillageInput, UpdateVillageInput } from '../schemas/village';
import type { VillageManager } from '../village-manager';

export function villageRoutes(mgr: VillageManager): Hono {
  const app = new Hono();

  app.get('/api/villages', (c) => {
    const status = c.req.query('status') || undefined;
    return c.json({ ok: true, data: mgr.list(status ? { status } : undefined) });
  });

  app.post('/api/villages', async (c) => {
    const parsed = CreateVillageInput.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: parsed.error.message } }, 400);
    }
    return c.json({ ok: true, data: mgr.create(parsed.data, 'human') }, 201);
  });

  app.get('/api/villages/:id', (c) => {
    const v = mgr.get(c.req.param('id'));
    if (!v) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Village not found' } }, 404);
    return c.json({ ok: true, data: v });
  });

  app.patch('/api/villages/:id', async (c) => {
    const parsed = UpdateVillageInput.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: parsed.error.message } }, 400);
    }
    try {
      return c.json({ ok: true, data: mgr.update(c.req.param('id'), parsed.data, 'human') });
    } catch (e: any) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: e.message } }, 404);
    }
  });

  app.delete('/api/villages/:id', (c) => {
    try {
      mgr.archive(c.req.param('id'), 'human');
      return c.json({ ok: true, data: null });
    } catch (e: any) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: e.message } }, 404);
    }
  });

  return app;
}
```

### 掛載到 index.ts

```typescript
// src/index.ts 加入：
import { createDb, initSchema } from './db';
import { VillageManager } from './village-manager';
import { villageRoutes } from './routes/villages';

const db = createDb();
initSchema(db);
const villageMgr = new VillageManager(db);

app.route('', villageRoutes(villageMgr));
```

### src/village-manager.test.ts

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, initSchema } from './db';
import { VillageManager } from './village-manager';

describe('VillageManager', () => {
  let mgr: VillageManager;
  let db: any;

  beforeEach(() => {
    db = createDb(':memory:');
    initSchema(db);
    mgr = new VillageManager(db);
  });

  it('create → id starts with village-, version 1, status active', () => {
    const v = mgr.create({ name: 'test', target_repo: 'fagemx/test' }, 'u');
    expect(v.id).toMatch(/^village-/);
    expect(v.version).toBe(1);
    expect(v.status).toBe('active');
  });

  it('get → returns created village', () => {
    const v = mgr.create({ name: 'test', target_repo: 'r' }, 'u');
    expect(mgr.get(v.id)?.name).toBe('test');
  });

  it('get non-existent → null', () => {
    expect(mgr.get('xxx')).toBeNull();
  });

  it('update → version +1, updated_at changes, name changes', () => {
    const v = mgr.create({ name: 'old', target_repo: 'r' }, 'u');
    const u = mgr.update(v.id, { name: 'new' }, 'u');
    expect(u.version).toBe(2);
    expect(u.name).toBe('new');
    expect(u.updated_at).not.toBe(v.updated_at);
  });

  it('archive → status archived', () => {
    const v = mgr.create({ name: 'x', target_repo: 'r' }, 'u');
    mgr.archive(v.id, 'u');
    expect(mgr.get(v.id)?.status).toBe('archived');
  });

  it('list → returns all villages', () => {
    mgr.create({ name: 'a', target_repo: 'r1' }, 'u');
    mgr.create({ name: 'b', target_repo: 'r2' }, 'u');
    expect(mgr.list()).toHaveLength(2);
  });

  it('list with status filter', () => {
    mgr.create({ name: 'a', target_repo: 'r1' }, 'u');
    const b = mgr.create({ name: 'b', target_repo: 'r2' }, 'u');
    mgr.archive(b.id, 'u');
    expect(mgr.list({ status: 'active' })).toHaveLength(1);
    expect(mgr.list({ status: 'archived' })).toHaveLength(1);
  });

  it('audit log written on create', () => {
    const v = mgr.create({ name: 'x', target_repo: 'r' }, 'actor1');
    const logs = db.prepare('SELECT * FROM audit_log WHERE entity_id = ?').all(v.id);
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe('create');
    expect(logs[0].actor).toBe('actor1');
  });

  it('audit log written on update', () => {
    const v = mgr.create({ name: 'x', target_repo: 'r' }, 'u');
    mgr.update(v.id, { name: 'y' }, 'u');
    const logs = db.prepare('SELECT * FROM audit_log WHERE entity_id = ?').all(v.id);
    expect(logs).toHaveLength(2); // create + update
  });

  it('metadata round-trips as object', () => {
    const v = mgr.create({ name: 'x', target_repo: 'r', metadata: { foo: 'bar' } }, 'u');
    expect(mgr.get(v.id)?.metadata).toEqual({ foo: 'bar' });
  });

  it('update non-existent → throws', () => {
    expect(() => mgr.update('xxx', { name: 'y' }, 'u')).toThrow();
  });
});
```

---

## 驗收

```bash
bun run build
bun test src/village-manager.test.ts   # 全部通過

# API 冒煙
bun run dev &
sleep 1
curl -s http://localhost:3462/api/villages | jq '.ok'                  # true
curl -s -X POST http://localhost:3462/api/villages \
  -H "Content-Type: application/json" \
  -d '{"name":"my-saas","target_repo":"fagemx/saas"}' | jq '.data.id' # village-xxx
curl -s http://localhost:3462/api/villages | jq '.data | length'       # 1
kill %1
```

---

## T1 完成檢查

```
[x] T1_01: Project Init — bun run build 通過
[x] T1_02: DB Layer — villages + audit_log table 存在
[x] T1_03: Village Core — CRUD 邏輯正確
[x] T1_04: Routes + Tests — API + 測試通過
→ T1 完成，可開始 T2 和 T7
```
