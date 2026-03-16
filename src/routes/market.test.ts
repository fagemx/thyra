import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, initSchema } from '../db';
import type { Database } from 'bun:sqlite';
import { VillageManager } from '../village-manager';
import { ZoneManager } from '../market/zones';
import { StallManager } from '../market/stalls';
import { SlotManager } from '../market/slots';
import { marketRoutes } from './market';

describe('market routes', () => {
  let app: ReturnType<typeof marketRoutes>;
  let db: Database;
  let villageId: string;
  let zoneId: string;

  beforeEach(() => {
    db = createDb(':memory:');
    initSchema(db);

    const villageMgr = new VillageManager(db);
    const zoneManager = new ZoneManager(db);
    const stallManager = new StallManager(db);
    const slotManager = new SlotManager(db);

    app = marketRoutes({ db, zoneManager, stallManager, slotManager });

    const village = villageMgr.create(
      { name: 'MarketTest', target_repo: 'fagemx/mt' },
      'human',
    );
    villageId = village.id;

    // Create a zone for stall/slot tests
    const zone = zoneManager.create(villageId, {
      name: 'Main Street',
      type: 'main_street',
      capacity: 50,
    }, 'human');
    zoneId = zone.id;
  });

  // ---- GET /state ----

  describe('GET /api/market/:vid/state', () => {
    it('200 — returns full market state', async () => {
      const res = await app.request(`/api/market/${villageId}/state`);
      expect(res.status).toBe(200);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.ok).toBe(true);
      const data = json.data as Record<string, unknown>;
      expect(data.zones).toBeDefined();
      expect(data.stalls).toBeDefined();
      expect(data.event_slots).toBeDefined();
      expect(data.assembled_at).toBeDefined();
    });

    it('404 — village not found', async () => {
      const res = await app.request('/api/market/nonexistent/state');
      expect(res.status).toBe(404);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.ok).toBe(false);
    });
  });

  // ---- GET /zones ----

  describe('GET /api/market/:vid/zones', () => {
    it('200 — returns zones list', async () => {
      const res = await app.request(`/api/market/${villageId}/zones`);
      expect(res.status).toBe(200);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.ok).toBe(true);
      const data = json.data as Array<Record<string, unknown>>;
      expect(data.length).toBe(1);
      expect(data[0].name).toBe('Main Street');
    });
  });

  // ---- POST /zones ----

  describe('POST /api/market/:vid/zones', () => {
    it('201 — creates zone', async () => {
      const res = await app.request(`/api/market/${villageId}/zones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Side Alley', type: 'side_alley', capacity: 20 }),
      });
      expect(res.status).toBe(201);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.ok).toBe(true);
      const data = json.data as Record<string, unknown>;
      expect(data.name).toBe('Side Alley');
      expect(data.type).toBe('side_alley');
    });

    it('400 — invalid input', async () => {
      const res = await app.request(`/api/market/${villageId}/zones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '' }),
      });
      expect(res.status).toBe(400);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.ok).toBe(false);
    });
  });

  // ---- GET /stalls ----

  describe('GET /api/market/:vid/stalls', () => {
    it('200 — returns stalls list', async () => {
      const res = await app.request(`/api/market/${villageId}/stalls`);
      expect(res.status).toBe(200);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.ok).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);
    });

    it('200 — filters by zone_id', async () => {
      // Create a stall first
      await app.request(`/api/market/${villageId}/stalls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zone_id: zoneId, name: 'Ramen Shop' }),
      });

      const res = await app.request(`/api/market/${villageId}/stalls?zone_id=${zoneId}`);
      expect(res.status).toBe(200);
      const json = (await res.json()) as Record<string, unknown>;
      const data = json.data as Array<Record<string, unknown>>;
      expect(data.length).toBe(1);
      expect(data[0].zone_id).toBe(zoneId);
    });

    it('200 — sorts by rank', async () => {
      const res = await app.request(`/api/market/${villageId}/stalls?sort_by=rank`);
      expect(res.status).toBe(200);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.ok).toBe(true);
    });
  });

  // ---- POST /stalls ----

  describe('POST /api/market/:vid/stalls', () => {
    it('201 — creates stall', async () => {
      const res = await app.request(`/api/market/${villageId}/stalls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zone_id: zoneId, name: 'Takoyaki Stand' }),
      });
      expect(res.status).toBe(201);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.ok).toBe(true);
      const data = json.data as Record<string, unknown>;
      expect(data.name).toBe('Takoyaki Stand');
      expect(data.zone_id).toBe(zoneId);
    });

    it('400 — missing zone_id', async () => {
      const res = await app.request(`/api/market/${villageId}/stalls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'No Zone' }),
      });
      expect(res.status).toBe(400);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.ok).toBe(false);
    });
  });

  // ---- PATCH /stalls/:id ----

  describe('PATCH /api/market/:vid/stalls/:id', () => {
    it('200 — updates stall', async () => {
      // Create a stall first
      const createRes = await app.request(`/api/market/${villageId}/stalls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zone_id: zoneId, name: 'Old Name' }),
      });
      const createJson = (await createRes.json()) as Record<string, unknown>;
      const stallId = (createJson.data as Record<string, unknown>).id as string;

      const res = await app.request(`/api/market/${villageId}/stalls/${stallId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Name' }),
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.ok).toBe(true);
      const data = json.data as Record<string, unknown>;
      expect(data.name).toBe('New Name');
    });

    it('404 — stall not found', async () => {
      const res = await app.request(`/api/market/${villageId}/stalls/stall-nonexistent`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Ghost' }),
      });
      expect(res.status).toBe(404);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.ok).toBe(false);
    });
  });

  // ---- GET /slots ----

  describe('GET /api/market/:vid/slots', () => {
    it('200 — returns slots list', async () => {
      const res = await app.request(`/api/market/${villageId}/slots`);
      expect(res.status).toBe(200);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.ok).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);
    });
  });

  // ---- POST /slots ----

  describe('POST /api/market/:vid/slots', () => {
    it('201 — creates slot', async () => {
      const res = await app.request(`/api/market/${villageId}/slots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Live Music',
          description: 'Jazz night',
          start_time: '2026-03-16T20:00:00Z',
          end_time: '2026-03-16T22:00:00Z',
          capacity: 30,
        }),
      });
      expect(res.status).toBe(201);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.ok).toBe(true);
      const data = json.data as Record<string, unknown>;
      expect(data.title).toBe('Live Music');
      expect(data.capacity).toBe(30);
    });

    it('400 — invalid input', async () => {
      const res = await app.request(`/api/market/${villageId}/slots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '' }),
      });
      expect(res.status).toBe(400);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.ok).toBe(false);
    });
  });

  // ---- POST /slots/:id/book ----

  describe('POST /api/market/:vid/slots/:id/book', () => {
    let slotId: string;

    beforeEach(async () => {
      const createRes = await app.request(`/api/market/${villageId}/slots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Bookable Event',
          description: 'Test booking',
          start_time: '2026-03-16T20:00:00Z',
          end_time: '2026-03-16T22:00:00Z',
          capacity: 2,
        }),
      });
      const createJson = (await createRes.json()) as Record<string, unknown>;
      slotId = (createJson.data as Record<string, unknown>).id as string;
    });

    it('200 — books slot', async () => {
      const res = await app.request(`/api/market/${villageId}/slots/${slotId}/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ buyer: 'alice' }),
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.ok).toBe(true);
      const data = json.data as Record<string, unknown>;
      expect(data.booked).toBe(1);
    });

    it('400 — missing buyer', async () => {
      const res = await app.request(`/api/market/${villageId}/slots/${slotId}/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.ok).toBe(false);
    });

    it('404 — slot not found', async () => {
      const res = await app.request(`/api/market/${villageId}/slots/slot-nonexistent/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ buyer: 'bob' }),
      });
      expect(res.status).toBe(404);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.ok).toBe(false);
    });

    it('409 — slot is full', async () => {
      // Book twice to fill capacity of 2
      await app.request(`/api/market/${villageId}/slots/${slotId}/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ buyer: 'alice' }),
      });
      await app.request(`/api/market/${villageId}/slots/${slotId}/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ buyer: 'bob' }),
      });

      // Third booking should fail
      const res = await app.request(`/api/market/${villageId}/slots/${slotId}/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ buyer: 'charlie' }),
      });
      expect(res.status).toBe(409);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.ok).toBe(false);
    });
  });

  // ---- GET /metrics ----

  describe('GET /api/market/:vid/metrics', () => {
    it('200 — returns null when no metrics', async () => {
      const res = await app.request(`/api/market/${villageId}/metrics`);
      expect(res.status).toBe(200);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.ok).toBe(true);
      expect(json.data).toBeNull();
    });
  });
});
