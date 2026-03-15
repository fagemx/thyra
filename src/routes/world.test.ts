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
});
