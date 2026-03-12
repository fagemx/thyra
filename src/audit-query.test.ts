import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { Hono } from 'hono';
import { createDb, initSchema, appendAudit } from './db';
import { AuditQuery } from './audit-query';
import { auditRoutes } from './routes/audit';

describe('AuditQuery', () => {
  let db: Database;
  let aq: AuditQuery;

  beforeEach(() => {
    db = createDb(':memory:');
    initSchema(db);
    aq = new AuditQuery(db);
  });

  // ── Helper: insert audit with specific created_at ──
  function insertAudit(
    entityType: string,
    entityId: string,
    action: string,
    payload: unknown,
    actor: string,
    createdAt?: string,
  ): void {
    db.prepare(`
      INSERT INTO audit_log (entity_type, entity_id, action, payload, actor, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(entityType, entityId, action, JSON.stringify(payload), actor, createdAt ?? new Date().toISOString());
  }

  // ── Helper: create village row for village-scoped queries ──
  function createVillage(id: string): void {
    db.prepare(`
      INSERT INTO villages (id, name, target_repo, version, created_at, updated_at)
      VALUES (?, 'test', 'repo', 1, ?, ?)
    `).run(id, new Date().toISOString(), new Date().toISOString());
  }

  function createConstitution(id: string, villageId: string): void {
    db.prepare(`
      INSERT INTO constitutions (id, village_id, version, status, created_at, created_by)
      VALUES (?, ?, 1, 'active', ?, 'sys')
    `).run(id, villageId, new Date().toISOString());
  }

  function createChief(id: string, villageId: string): void {
    db.prepare(`
      INSERT INTO chiefs (id, village_id, name, role, version, created_at, updated_at)
      VALUES (?, ?, 'chief', 'role', 1, ?, ?)
    `).run(id, villageId, new Date().toISOString(), new Date().toISOString());
  }

  function createLaw(id: string, villageId: string): void {
    db.prepare(`
      INSERT INTO laws (id, village_id, proposed_by, version, category, content, risk_level, created_at, updated_at)
      VALUES (?, ?, 'chief-1', 1, 'ops', 'content', 'low', ?, ?)
    `).run(id, villageId, new Date().toISOString(), new Date().toISOString());
  }

  // ────────── query() tests ──────────

  describe('query()', () => {
    it('returns all events when no filters, ordered by created_at DESC', () => {
      insertAudit('village', 'v-1', 'create', { n: 1 }, 'alice', '2026-01-01T00:00:00.000Z');
      insertAudit('chief', 'c-1', 'create', { n: 2 }, 'bob', '2026-01-02T00:00:00.000Z');
      insertAudit('law', 'l-1', 'proposed', { n: 3 }, 'alice', '2026-01-03T00:00:00.000Z');

      const result = aq.query({ limit: 50, offset: 0 });
      expect(result.total).toBe(3);
      expect(result.events).toHaveLength(3);
      // newest first
      expect(result.events[0].entity_id).toBe('l-1');
      expect(result.events[2].entity_id).toBe('v-1');
    });

    it('filters by entity_type', () => {
      insertAudit('village', 'v-1', 'create', {}, 'a');
      insertAudit('chief', 'c-1', 'create', {}, 'a');
      insertAudit('village', 'v-2', 'update', {}, 'a');

      const result = aq.query({ entity_type: 'village', limit: 50, offset: 0 });
      expect(result.total).toBe(2);
      expect(result.events.every((e) => e.entity_type === 'village')).toBe(true);
    });

    it('filters by entity_id', () => {
      insertAudit('village', 'v-1', 'create', {}, 'a');
      insertAudit('village', 'v-1', 'update', {}, 'a');
      insertAudit('village', 'v-2', 'create', {}, 'a');

      const result = aq.query({ entity_id: 'v-1', limit: 50, offset: 0 });
      expect(result.total).toBe(2);
      expect(result.events.every((e) => e.entity_id === 'v-1')).toBe(true);
    });

    it('filters by action', () => {
      insertAudit('village', 'v-1', 'create', {}, 'a');
      insertAudit('village', 'v-2', 'update', {}, 'a');
      insertAudit('chief', 'c-1', 'create', {}, 'a');

      const result = aq.query({ action: 'create', limit: 50, offset: 0 });
      expect(result.total).toBe(2);
      expect(result.events.every((e) => e.action === 'create')).toBe(true);
    });

    it('filters by actor', () => {
      insertAudit('village', 'v-1', 'create', {}, 'alice');
      insertAudit('village', 'v-2', 'create', {}, 'bob');

      const result = aq.query({ actor: 'alice', limit: 50, offset: 0 });
      expect(result.total).toBe(1);
      expect(result.events[0].actor).toBe('alice');
    });

    it('filters by time range (from/to)', () => {
      insertAudit('village', 'v-1', 'create', {}, 'a', '2026-01-01T00:00:00.000Z');
      insertAudit('village', 'v-2', 'create', {}, 'a', '2026-01-15T00:00:00.000Z');
      insertAudit('village', 'v-3', 'create', {}, 'a', '2026-02-01T00:00:00.000Z');

      const result = aq.query({
        from: '2026-01-10T00:00:00.000Z',
        to: '2026-01-20T00:00:00.000Z',
        limit: 50,
        offset: 0,
      });
      expect(result.total).toBe(1);
      expect(result.events[0].entity_id).toBe('v-2');
    });

    it('combines multiple filters', () => {
      insertAudit('village', 'v-1', 'create', {}, 'alice');
      insertAudit('village', 'v-2', 'update', {}, 'alice');
      insertAudit('chief', 'c-1', 'create', {}, 'alice');
      insertAudit('village', 'v-3', 'create', {}, 'bob');

      const result = aq.query({
        entity_type: 'village',
        action: 'create',
        actor: 'alice',
        limit: 50,
        offset: 0,
      });
      expect(result.total).toBe(1);
      expect(result.events[0].entity_id).toBe('v-1');
    });

    it('paginates with limit and offset', () => {
      for (let i = 0; i < 5; i++) {
        insertAudit('village', `v-${i}`, 'create', {}, 'a', `2026-01-0${i + 1}T00:00:00.000Z`);
      }

      const page1 = aq.query({ limit: 2, offset: 0 });
      expect(page1.events).toHaveLength(2);
      expect(page1.events[0].entity_id).toBe('v-4'); // newest first

      const page2 = aq.query({ limit: 2, offset: 2 });
      expect(page2.events).toHaveLength(2);
      expect(page2.events[0].entity_id).toBe('v-2');
    });

    it('total is unaffected by limit/offset', () => {
      for (let i = 0; i < 5; i++) {
        insertAudit('village', `v-${i}`, 'create', {}, 'a');
      }

      const result = aq.query({ limit: 2, offset: 3 });
      expect(result.total).toBe(5);
      expect(result.events).toHaveLength(2);
      expect(result.limit).toBe(2);
      expect(result.offset).toBe(3);
    });

    it('returns empty results', () => {
      const result = aq.query({ limit: 50, offset: 0 });
      expect(result.total).toBe(0);
      expect(result.events).toEqual([]);
    });

    it('parses payload JSON correctly', () => {
      insertAudit('village', 'v-1', 'create', { foo: 'bar', count: 42 }, 'a');
      const result = aq.query({ limit: 50, offset: 0 });
      expect(result.events[0].payload).toEqual({ foo: 'bar', count: 42 });
    });
  });

  // ────────── queryByVillage() tests ──────────

  describe('queryByVillage()', () => {
    it('returns events for village and all related entities', () => {
      const vid = 'village-1';
      createVillage(vid);
      createConstitution('const-1', vid);
      createChief('chief-1', vid);
      createLaw('law-1', vid);

      insertAudit('village', vid, 'create', {}, 'a', '2026-01-01T00:00:00.000Z');
      insertAudit('constitution', 'const-1', 'create', {}, 'a', '2026-01-02T00:00:00.000Z');
      insertAudit('chief', 'chief-1', 'create', {}, 'a', '2026-01-03T00:00:00.000Z');
      insertAudit('law', 'law-1', 'proposed', {}, 'a', '2026-01-04T00:00:00.000Z');

      const result = aq.queryByVillage(vid, { limit: 50, offset: 0 });
      expect(result.total).toBe(4);
      expect(result.events).toHaveLength(4);
    });

    it('excludes events from other villages', () => {
      const vid1 = 'village-1';
      const vid2 = 'village-2';
      createVillage(vid1);
      createVillage(vid2);
      createConstitution('const-1', vid1);
      createConstitution('const-2', vid2);

      insertAudit('village', vid1, 'create', {}, 'a');
      insertAudit('constitution', 'const-1', 'create', {}, 'a');
      insertAudit('village', vid2, 'create', {}, 'a');
      insertAudit('constitution', 'const-2', 'create', {}, 'a');

      const result = aq.queryByVillage(vid1, { limit: 50, offset: 0 });
      expect(result.total).toBe(2);
      expect(result.events.every((e) =>
        e.entity_id === vid1 || e.entity_id === 'const-1'
      )).toBe(true);
    });

    it('supports action filter', () => {
      const vid = 'village-1';
      createVillage(vid);

      insertAudit('village', vid, 'create', {}, 'a');
      insertAudit('village', vid, 'update', {}, 'a');

      const result = aq.queryByVillage(vid, { action: 'create', limit: 50, offset: 0 });
      expect(result.total).toBe(1);
      expect(result.events[0].action).toBe('create');
    });

    it('supports pagination', () => {
      const vid = 'village-1';
      createVillage(vid);
      createConstitution('const-1', vid);
      createChief('chief-1', vid);

      insertAudit('village', vid, 'create', {}, 'a', '2026-01-01T00:00:00.000Z');
      insertAudit('constitution', 'const-1', 'create', {}, 'a', '2026-01-02T00:00:00.000Z');
      insertAudit('chief', 'chief-1', 'create', {}, 'a', '2026-01-03T00:00:00.000Z');

      const result = aq.queryByVillage(vid, { limit: 1, offset: 1 });
      expect(result.total).toBe(3);
      expect(result.events).toHaveLength(1);
      expect(result.events[0].entity_id).toBe('const-1'); // middle one
    });

    it('returns empty for non-existent village', () => {
      const result = aq.queryByVillage('village-nonexistent', { limit: 50, offset: 0 });
      expect(result.total).toBe(0);
      expect(result.events).toEqual([]);
    });
  });

  // ────────── Route integration tests ──────────

  describe('routes', () => {
    let app: Hono;

    beforeEach(() => {
      app = auditRoutes(aq);
    });

    it('GET /api/audit returns 200 with THY-11 format', async () => {
      insertAudit('village', 'v-1', 'create', { x: 1 }, 'alice');

      const res = await app.request('/api/audit');
      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean; data: { events: unknown[]; total: number; limit: number; offset: number } };
      expect(body.ok).toBe(true);
      expect(body.data.events).toHaveLength(1);
      expect(body.data.total).toBe(1);
      expect(body.data.limit).toBe(50);
      expect(body.data.offset).toBe(0);
    });

    it('GET /api/audit?entity_type=village filters correctly', async () => {
      insertAudit('village', 'v-1', 'create', {}, 'a');
      insertAudit('chief', 'c-1', 'create', {}, 'a');

      const res = await app.request('/api/audit?entity_type=village');
      const body = await res.json() as { ok: boolean; data: { events: Array<{ entity_type: string }>; total: number } };
      expect(body.ok).toBe(true);
      expect(body.data.total).toBe(1);
      expect(body.data.events[0].entity_type).toBe('village');
    });

    it('GET /api/audit with invalid limit returns 400', async () => {
      const res = await app.request('/api/audit?limit=-1');
      expect(res.status).toBe(400);
      const body = await res.json() as { ok: boolean; error: { code: string } };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('VALIDATION');
    });

    it('GET /api/villages/:vid/audit returns village audit trail', async () => {
      const vid = 'village-1';
      createVillage(vid);
      createConstitution('const-1', vid);

      insertAudit('village', vid, 'create', {}, 'a');
      insertAudit('constitution', 'const-1', 'create', {}, 'a');
      insertAudit('village', 'village-2', 'create', {}, 'a'); // other village

      const res = await app.request(`/api/villages/${vid}/audit`);
      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean; data: { events: unknown[]; total: number } };
      expect(body.ok).toBe(true);
      expect(body.data.total).toBe(2);
    });

    it('GET /api/villages/:vid/audit?limit=1&offset=1 paginates', async () => {
      const vid = 'village-1';
      createVillage(vid);

      insertAudit('village', vid, 'create', {}, 'a', '2026-01-01T00:00:00.000Z');
      insertAudit('village', vid, 'update', {}, 'a', '2026-01-02T00:00:00.000Z');

      const res = await app.request(`/api/villages/${vid}/audit?limit=1&offset=1`);
      const body = await res.json() as { ok: boolean; data: { events: Array<{ action: string }>; total: number; limit: number; offset: number } };
      expect(body.ok).toBe(true);
      expect(body.data.total).toBe(2);
      expect(body.data.events).toHaveLength(1);
      expect(body.data.limit).toBe(1);
      expect(body.data.offset).toBe(1);
    });
  });
});
