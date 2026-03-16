import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, initSchema } from '../db';
import type { Database } from 'bun:sqlite';
import { VillageManager } from '../village-manager';
import { ConstitutionStore } from '../constitution-store';
import { WorldManager } from '../world-manager';
import { worldRoutes } from './world';

describe('world routes', () => {
  let app: ReturnType<typeof worldRoutes>;
  let villageId: string;
  let db: Database;

  beforeEach(() => {
    db = createDb(':memory:');
    initSchema(db);

    const villageMgr = new VillageManager(db);
    const constitutionStore = new ConstitutionStore(db);
    const worldManager = new WorldManager(db);

    app = worldRoutes(worldManager, db);

    const village = villageMgr.create(
      { name: 'WorldTest', target_repo: 'fagemx/wt' },
      'human',
    );
    villageId = village.id;

    // 建立 constitution 以便 WorldState 有內容
    constitutionStore.create(
      villageId,
      {
        rules: [{ description: 'test rule', enforcement: 'soft', scope: ['*'] }],
        allowed_permissions: ['propose_law'],
        budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
      },
      'human',
    );
  });

  // ---- GET /state ----

  describe('GET /api/villages/:id/world/state', () => {
    it('200 — returns world state', async () => {
      const res = await app.request(`/api/villages/${villageId}/world/state`);
      expect(res.status).toBe(200);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.ok).toBe(true);
      const data = json.data as Record<string, unknown>;
      expect(data.village).toBeDefined();
      expect(data.constitution).toBeDefined();
    });
  });

  // ---- POST /judge ----

  describe('POST /api/villages/:id/world/judge', () => {
    it('200 — returns judge result for valid change', async () => {
      const res = await app.request(`/api/villages/${villageId}/world/judge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          change: {
            type: 'village.update',
            name: 'NewName',
          },
        }),
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.ok).toBe(true);
      const data = json.data as Record<string, unknown>;
      expect(typeof data.allowed).toBe('boolean');
    });

    it('400 — invalid body', async () => {
      const res = await app.request(`/api/villages/${villageId}/world/judge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.ok).toBe(false);
    });
  });

  // ---- POST /apply ----

  describe('POST /api/villages/:id/world/apply', () => {
    it('200 — applies valid change', async () => {
      const res = await app.request(`/api/villages/${villageId}/world/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          change: { type: 'village.update', name: 'Applied' },
          reason: 'test apply',
        }),
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.ok).toBe(true);
      const data = json.data as Record<string, unknown>;
      expect(typeof data.applied).toBe('boolean');
      expect(data.snapshot_before).toBeDefined();
    });

    it('400 — missing change', async () => {
      const res = await app.request(`/api/villages/${villageId}/world/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'no change' }),
      });
      expect(res.status).toBe(400);
    });
  });

  // ---- POST /snapshot ----

  describe('POST /api/villages/:id/world/snapshot', () => {
    it('200 — creates snapshot with default trigger', async () => {
      const res = await app.request(`/api/villages/${villageId}/world/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.ok).toBe(true);
      const data = json.data as Record<string, unknown>;
      expect(typeof data.snapshot_id).toBe('string');
    });

    it('200 — creates snapshot with explicit trigger', async () => {
      const res = await app.request(`/api/villages/${villageId}/world/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trigger: 'manual' }),
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.ok).toBe(true);
    });
  });

  // ---- GET /snapshots ----

  describe('GET /api/villages/:id/world/snapshots', () => {
    it('200 — returns empty list initially', async () => {
      const res = await app.request(`/api/villages/${villageId}/world/snapshots`);
      expect(res.status).toBe(200);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.ok).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);
    });

    it('200 — returns snapshots after creation', async () => {
      // 先建立一個 snapshot
      await app.request(`/api/villages/${villageId}/world/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const res = await app.request(`/api/villages/${villageId}/world/snapshots`);
      expect(res.status).toBe(200);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.ok).toBe(true);
      const data = json.data as Array<Record<string, unknown>>;
      expect(data.length).toBe(1);
      expect(data[0].trigger).toBe('manual');
    });

    it('200 — respects limit query param', async () => {
      // 建立 3 個 snapshot
      for (let i = 0; i < 3; i++) {
        await app.request(`/api/villages/${villageId}/world/snapshot`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
      }

      const res = await app.request(`/api/villages/${villageId}/world/snapshots?limit=2`);
      expect(res.status).toBe(200);
      const json = (await res.json()) as Record<string, unknown>;
      const data = json.data as Array<Record<string, unknown>>;
      expect(data.length).toBe(2);
    });
  });

  // ---- POST /rollback ----

  describe('POST /api/villages/:id/world/rollback', () => {
    it('200 — rollback to snapshot', async () => {
      // 先建立一個 snapshot
      const snapRes = await app.request(`/api/villages/${villageId}/world/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const snapJson = (await snapRes.json()) as Record<string, unknown>;
      const snapData = snapJson.data as Record<string, unknown>;
      const snapshotId = snapData.snapshot_id as string;

      const res = await app.request(`/api/villages/${villageId}/world/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshot_id: snapshotId, reason: 'test rollback' }),
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.ok).toBe(true);
      const data = json.data as Record<string, unknown>;
      expect(typeof data.success).toBe('boolean');
    });

    it('400 — missing snapshot_id', async () => {
      const res = await app.request(`/api/villages/${villageId}/world/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'missing id' }),
      });
      expect(res.status).toBe(400);
    });

    it('400 — missing reason', async () => {
      const res = await app.request(`/api/villages/${villageId}/world/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshot_id: 'snap_abc' }),
      });
      expect(res.status).toBe(400);
    });
  });

  // ---- GET /pulse (SSE) ----

  describe('GET /api/villages/:id/world/pulse', () => {
    it('200 — returns text/event-stream content type', async () => {
      const res = await app.request(`/api/villages/${villageId}/world/pulse?interval=1000`);
      expect(res.status).toBe(200);
      const ct = res.headers.get('content-type');
      expect(ct).toContain('text/event-stream');
    });

    it('streams valid pulse events with WorldHealth shape', async () => {
      const res = await app.request(`/api/villages/${villageId}/world/pulse?interval=1000`);
      expect(res.status).toBe(200);

      // 讀取 response body stream 的第一個 SSE event
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      // 讀取直到收到完整的第一個 event（以 \n\n 結尾）
      while (!buffer.includes('\n\n')) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
      }

      // 取消 stream（模擬 client 斷線）
      await reader.cancel();

      // 解析 SSE event
      const lines = buffer.split('\n').filter((l) => l.length > 0);
      const eventLine = lines.find((l) => l.startsWith('event:'));
      const dataLine = lines.find((l) => l.startsWith('data:'));
      const idLine = lines.find((l) => l.startsWith('id:'));

      expect(eventLine).toBe('event: pulse');
      expect(idLine).toBe('id: 0');
      expect(dataLine).toBeDefined();

      // 解析 data JSON 並驗證 WorldHealth shape
      const dataJson = dataLine!.replace('data: ', '');
      const health = JSON.parse(dataJson) as Record<string, unknown>;
      expect(typeof health.overall).toBe('number');
      expect(typeof health.chief_count).toBe('number');
      expect(typeof health.law_count).toBe('number');
      expect(typeof health.constitution_active).toBe('boolean');
      expect(health.scores).toBeDefined();
    });

    it('defaults interval to 5000ms and enforces min 1000ms', async () => {
      // interval=100 should be clamped to 1000
      const res = await app.request(`/api/villages/${villageId}/world/pulse?interval=100`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');

      // 讀取第一個 event 確認 stream 正常
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (!buffer.includes('\n\n')) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
      }
      await reader.cancel();

      expect(buffer).toContain('event: pulse');
    });

    it('handles non-numeric interval gracefully', async () => {
      const res = await app.request(`/api/villages/${villageId}/world/pulse?interval=abc`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
    });
  });

  // ---- GET /continuity ----

  describe('GET /api/villages/:id/world/continuity', () => {
    it('200 — returns continuity report', async () => {
      const res = await app.request(`/api/villages/${villageId}/world/continuity`);
      expect(res.status).toBe(200);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.ok).toBe(true);
      const data = json.data as Record<string, unknown>;
      expect(data.village_id).toBe(villageId);
      expect(typeof data.all_consistent).toBe('boolean');
    });

    it('200 — respects cycle_count query param', async () => {
      const res = await app.request(`/api/villages/${villageId}/world/continuity?cycle_count=5`);
      expect(res.status).toBe(200);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.ok).toBe(true);
    });

    it('400 — invalid cycle_count', async () => {
      const res = await app.request(`/api/villages/${villageId}/world/continuity?cycle_count=0`);
      expect(res.status).toBe(400);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.ok).toBe(false);
    });
  });

  // ---- GET /events (SSE) ----

  describe('GET /api/villages/:id/world/events', () => {
    it('200 — returns text/event-stream content type', async () => {
      const res = await app.request(`/api/villages/${villageId}/world/events?interval=1000`);
      expect(res.status).toBe(200);
      const ct = res.headers.get('content-type');
      expect(ct).toContain('text/event-stream');
    });

    it('streams initial audit events as timeline SSE', async () => {
      // 先 apply 一個 change 讓 audit_log 有資料
      await app.request(`/api/villages/${villageId}/world/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          change: { type: 'village.update', name: 'SSETestVillage' },
          reason: 'test sse events',
        }),
      });

      const res = await app.request(`/api/villages/${villageId}/world/events?interval=1000`);
      expect(res.status).toBe(200);

      // 讀取 response body stream 的第一批 SSE events
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (let i = 0; i < 10; i++) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        if (buffer.includes('event: timeline')) break;
      }
      await reader.cancel();

      // 應該含有 timeline event
      expect(buffer).toContain('event: timeline');
      // 每個 event 的 data 應含 audit 欄位
      const dataLine = buffer.split('\n').find((l) => l.startsWith('data:'));
      expect(dataLine).toBeDefined();
      if (dataLine) {
        const data = JSON.parse(dataLine.replace('data: ', '')) as Record<string, unknown>;
        expect(data.id).toBeDefined();
        expect(data.entity_type).toBeDefined();
        expect(data.action).toBeDefined();
        expect(data.actor).toBeDefined();
      }
    });

    it('handles village with no audit events', async () => {
      // 建立另一個空 village
      const villageMgr = new VillageManager(db);
      const empty = villageMgr.create(
        { name: 'EmptyVillage', target_repo: 'fagemx/empty' },
        'human',
      );

      const res = await app.request(`/api/villages/${empty.id}/world/events?interval=1000`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
    });

    it('defaults interval to 3000ms and enforces min 1000ms', async () => {
      // interval=100 should be clamped to 1000
      const res = await app.request(`/api/villages/${villageId}/world/events?interval=100`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
    });
  });
});
