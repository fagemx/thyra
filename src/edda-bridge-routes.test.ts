import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { Database } from 'bun:sqlite';
import { createDb, initSchema } from './db';
import { EddaBridge } from './edda-bridge';
import { bridgeRoutes } from './routes/bridges';
import { KarviBridge } from './karvi-bridge';

describe('Edda Bridge Route Validation', () => {
  let db: Database;
  let app: Hono;

  beforeEach(() => {
    db = createDb(':memory:');
    initSchema(db);
    // Edda URL points to unreachable port — tests validate input before reaching Edda
    const karvi = new KarviBridge(db, 'http://localhost:19999');
    const edda = new EddaBridge(db, 'http://localhost:19465');
    app = new Hono();
    app.route('', bridgeRoutes(karvi, edda));
  });

  // --- POST /api/bridges/edda/query ---

  describe('POST /api/bridges/edda/query validation', () => {
    it('accepts empty body (all fields optional)', async () => {
      const res = await app.request('/api/bridges/edda/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
    });

    it('rejects limit with negative value', async () => {
      const res = await app.request('/api/bridges/edda/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: -1 }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe('VALIDATION');
    });

    it('rejects limit with zero', async () => {
      const res = await app.request('/api/bridges/edda/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 0 }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe('VALIDATION');
    });

    it('rejects limit exceeding max (100)', async () => {
      const res = await app.request('/api/bridges/edda/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 101 }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe('VALIDATION');
    });

    it('rejects limit with string type', async () => {
      const res = await app.request('/api/bridges/edda/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 'abc' }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe('VALIDATION');
    });

    it('rejects include_superseded with non-boolean', async () => {
      const res = await app.request('/api/bridges/edda/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ include_superseded: 'yes' }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe('VALIDATION');
    });

    it('rejects non-integer limit', async () => {
      const res = await app.request('/api/bridges/edda/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 3.5 }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe('VALIDATION');
    });
  });

  // --- POST /api/bridges/edda/decide ---

  describe('POST /api/bridges/edda/decide validation', () => {
    it('rejects empty body (missing required fields)', async () => {
      const res = await app.request('/api/bridges/edda/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe('VALIDATION');
    });

    it('rejects empty string domain', async () => {
      const res = await app.request('/api/bridges/edda/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: '', aspect: 'x', value: 'y' }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe('VALIDATION');
    });

    it('rejects empty string aspect', async () => {
      const res = await app.request('/api/bridges/edda/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: 'law', aspect: '', value: 'y' }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe('VALIDATION');
    });

    it('rejects empty string value', async () => {
      const res = await app.request('/api/bridges/edda/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: 'law', aspect: 'x', value: '' }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe('VALIDATION');
    });

    it('rejects non-string domain (number)', async () => {
      const res = await app.request('/api/bridges/edda/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: 123, aspect: 'x', value: 'y' }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe('VALIDATION');
    });

    it('rejects missing aspect field', async () => {
      const res = await app.request('/api/bridges/edda/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: 'law', value: 'y' }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe('VALIDATION');
    });

    it('accepts valid decide input (Edda offline → 502)', async () => {
      const res = await app.request('/api/bridges/edda/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: 'law', aspect: 'review_policy', value: '2 approvals' }),
      });
      expect(res.status).toBe(502);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe('EDDA_UNAVAILABLE');
    });
  });

  // --- POST /api/bridges/edda/note ---

  describe('POST /api/bridges/edda/note validation', () => {
    it('rejects empty body', async () => {
      const res = await app.request('/api/bridges/edda/note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe('VALIDATION');
    });

    it('rejects empty text', async () => {
      const res = await app.request('/api/bridges/edda/note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '' }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe('VALIDATION');
    });

    it('accepts valid note (Edda offline → 502)', async () => {
      const res = await app.request('/api/bridges/edda/note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'session note', tags: ['session'] }),
      });
      expect(res.status).toBe(502);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe('EDDA_UNAVAILABLE');
    });
  });
});
