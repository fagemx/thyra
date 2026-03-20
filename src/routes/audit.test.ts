import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { Database } from 'bun:sqlite';
import { initSchema, appendAudit } from '../db';
import { AuditQuery } from '../audit-query';
import { auditRoutes } from './audit';

function setupApp() {
  const db = new Database(':memory:');
  db.run('PRAGMA foreign_keys = ON');
  initSchema(db);

  const now = new Date().toISOString();
  // Insert a village for village-scoped audit queries
  db.prepare(
    'INSERT INTO villages (id, name, description, target_repo, status, metadata, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run('v1', 'Test Village', '', 'repo', 'active', '{}', 1, now, now);

  // Insert some audit entries
  appendAudit(db, 'village', 'v1', 'created', { name: 'Test Village' }, 'human');
  appendAudit(db, 'constitution', 'const-1', 'created', { village_id: 'v1' }, 'system');

  const auditQuery = new AuditQuery(db);
  const app = new Hono();
  app.route('', auditRoutes(auditQuery));

  return { app, db };
}

describe('Audit Routes', () => {
  let app: Hono;

  beforeEach(() => {
    const setup = setupApp();
    app = setup.app;
  });

  describe('GET /api/audit', () => {
    it('returns audit events with default pagination', async () => {
      const res = await app.request('/api/audit');
      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean; data: { events: unknown[]; total: number; limit: number; offset: number } };
      expect(body.ok).toBe(true);
      expect(body.data.events.length).toBe(2);
      expect(body.data.total).toBe(2);
      expect(body.data.limit).toBe(50);
      expect(body.data.offset).toBe(0);
    });

    it('filters by entity_type', async () => {
      const res = await app.request('/api/audit?entity_type=village');
      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean; data: { events: unknown[]; total: number } };
      expect(body.ok).toBe(true);
      expect(body.data.total).toBe(1);
    });

    it('filters by actor', async () => {
      const res = await app.request('/api/audit?actor=human');
      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean; data: { events: unknown[]; total: number } };
      expect(body.ok).toBe(true);
      expect(body.data.total).toBe(1);
    });

    it('respects limit and offset', async () => {
      const res = await app.request('/api/audit?limit=1&offset=0');
      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean; data: { events: unknown[]; total: number; limit: number } };
      expect(body.ok).toBe(true);
      expect(body.data.events.length).toBe(1);
      expect(body.data.total).toBe(2);
      expect(body.data.limit).toBe(1);
    });
  });

  describe('GET /api/villages/:vid/audit', () => {
    it('returns village-scoped audit events', async () => {
      const res = await app.request('/api/villages/v1/audit');
      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean; data: { events: unknown[]; total: number } };
      expect(body.ok).toBe(true);
      // Should find the village created event
      expect(body.data.total).toBeGreaterThanOrEqual(1);
    });

    it('returns empty for non-existent village', async () => {
      const res = await app.request('/api/villages/nonexistent/audit');
      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean; data: { events: unknown[]; total: number } };
      expect(body.ok).toBe(true);
      expect(body.data.total).toBe(0);
    });
  });
});
