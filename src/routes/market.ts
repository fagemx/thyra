/**
 * market.ts — Market API routes
 *
 * 10 endpoints on /api/market/:vid/:
 *   GET  /state         — assembleMarketState
 *   GET  /zones         — list zones
 *   POST /zones         — create zone
 *   GET  /stalls        — list stalls (filterable, sortable)
 *   POST /stalls        — create stall
 *   PATCH /stalls/:id   — update stall
 *   GET  /slots         — list event slots
 *   POST /slots         — create slot
 *   POST /slots/:id/book — book slot
 *   GET  /metrics       — latest metrics
 */

import { Hono } from 'hono';
import type { Database } from 'bun:sqlite';
import { z } from 'zod';
import { ZoneManager } from '../market/zones';
import { StallManager } from '../market/stalls';
import { SlotManager } from '../market/slots';
import { assembleMarketState } from '../market/state';
import {
  CreateZoneInput,
  CreateStallInput,
  UpdateStallInput,
  CreateSlotInput,
} from '../schemas/market';

const BookSlotBody = z.object({
  buyer: z.string().min(1),
});

const SortByEnum = z.enum(['rank', 'created_at']).optional();

interface MarketRouteDeps {
  db: Database;
  zoneManager: ZoneManager;
  stallManager: StallManager;
  slotManager: SlotManager;
}

function catchDomainError(err: unknown, c: { json: (data: unknown, status: number) => Response }): Response | null {
  if (err instanceof Error) {
    if (err.message.includes('not found') || err.message.includes('not found')) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: err.message } }, 404);
    }
    if (err.message.includes('CONCURRENCY_CONFLICT')) {
      return c.json({ ok: false, error: { code: 'CONCURRENCY_CONFLICT', message: err.message } }, 409);
    }
    if (err.message.includes('is full') || err.message.includes('has ended')) {
      return c.json({ ok: false, error: { code: 'CONFLICT', message: err.message } }, 409);
    }
  }
  return null;
}

export function marketRoutes(deps: MarketRouteDeps): Hono {
  const { db, zoneManager, stallManager, slotManager } = deps;
  const app = new Hono();
  const base = '/api/market/:vid';

  // 1. GET /state — full market state snapshot
  app.get(`${base}/state`, (c) => {
    const vid = c.req.param('vid');
    try {
      const state = assembleMarketState(db, vid);
      return c.json({ ok: true, data: state });
    } catch (err) {
      const handled = catchDomainError(err, c);
      if (handled) return handled;
      throw err;
    }
  });

  // 2. GET /zones — list zones
  app.get(`${base}/zones`, (c) => {
    const vid = c.req.param('vid');
    const zones = zoneManager.list(vid);
    return c.json({ ok: true, data: zones });
  });

  // 3. POST /zones — create zone
  app.post(`${base}/zones`, async (c) => {
    const vid = c.req.param('vid');
    const body: unknown = await c.req.json().catch(() => ({}));
    const parsed = CreateZoneInput.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { ok: false, error: { code: 'VALIDATION', message: parsed.error.message } },
        400,
      );
    }
    const zone = zoneManager.create(vid, parsed.data, 'human');
    return c.json({ ok: true, data: zone }, 201);
  });

  // 4. GET /stalls — list stalls (filterable, sortable)
  app.get(`${base}/stalls`, (c) => {
    const vid = c.req.param('vid');
    const zone_id = c.req.query('zone_id');
    const status = c.req.query('status');
    const sort_by_raw = c.req.query('sort_by');

    if (sort_by_raw) {
      const sortParsed = SortByEnum.safeParse(sort_by_raw);
      if (!sortParsed.success) {
        return c.json(
          { ok: false, error: { code: 'VALIDATION', message: 'sort_by must be "rank" or "created_at"' } },
          400,
        );
      }
    }

    const opts: { zone_id?: string; status?: string; sort_by?: 'rank' | 'created_at' } = {};
    if (zone_id) opts.zone_id = zone_id;
    if (status) opts.status = status;
    if (sort_by_raw) opts.sort_by = sort_by_raw as 'rank' | 'created_at';

    const stalls = stallManager.list(vid, opts);
    return c.json({ ok: true, data: stalls });
  });

  // 5. POST /stalls — create stall
  app.post(`${base}/stalls`, async (c) => {
    const vid = c.req.param('vid');
    const body: unknown = await c.req.json().catch(() => ({}));
    const parsed = CreateStallInput.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { ok: false, error: { code: 'VALIDATION', message: parsed.error.message } },
        400,
      );
    }
    const stall = stallManager.create(vid, parsed.data, 'human');
    return c.json({ ok: true, data: stall }, 201);
  });

  // 6. PATCH /stalls/:id — update stall
  app.patch(`${base}/stalls/:id`, async (c) => {
    const id = c.req.param('id');
    const body: unknown = await c.req.json().catch(() => ({}));
    const parsed = UpdateStallInput.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { ok: false, error: { code: 'VALIDATION', message: parsed.error.message } },
        400,
      );
    }
    try {
      const stall = stallManager.update(id, parsed.data, 'human');
      return c.json({ ok: true, data: stall });
    } catch (err) {
      const handled = catchDomainError(err, c);
      if (handled) return handled;
      throw err;
    }
  });

  // 7. GET /slots — list event slots
  app.get(`${base}/slots`, (c) => {
    const vid = c.req.param('vid');
    const status = c.req.query('status');
    const zone_id = c.req.query('zone_id');

    const opts: { status?: string; zone_id?: string } = {};
    if (status) opts.status = status;
    if (zone_id) opts.zone_id = zone_id;

    const slots = slotManager.list(vid, opts);
    return c.json({ ok: true, data: slots });
  });

  // 8. POST /slots — create slot
  app.post(`${base}/slots`, async (c) => {
    const vid = c.req.param('vid');
    const body: unknown = await c.req.json().catch(() => ({}));
    const parsed = CreateSlotInput.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { ok: false, error: { code: 'VALIDATION', message: parsed.error.message } },
        400,
      );
    }
    const slot = slotManager.create(vid, parsed.data, 'human');
    return c.json({ ok: true, data: slot }, 201);
  });

  // 9. POST /slots/:id/book — book a slot
  app.post(`${base}/slots/:id/book`, async (c) => {
    const vid = c.req.param('vid');
    const id = c.req.param('id');
    const body: unknown = await c.req.json().catch(() => ({}));
    const parsed = BookSlotBody.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { ok: false, error: { code: 'VALIDATION', message: parsed.error.message } },
        400,
      );
    }
    try {
      const slot = slotManager.book(id, vid, parsed.data.buyer, 'human');
      return c.json({ ok: true, data: slot });
    } catch (err) {
      const handled = catchDomainError(err, c);
      if (handled) return handled;
      throw err;
    }
  });

  // 10. GET /metrics — latest market metrics
  app.get(`${base}/metrics`, (c) => {
    const vid = c.req.param('vid');
    try {
      const state = assembleMarketState(db, vid);
      return c.json({ ok: true, data: state.metrics });
    } catch (err) {
      const handled = catchDomainError(err, c);
      if (handled) return handled;
      throw err;
    }
  });

  return app;
}
