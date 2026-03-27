import type { Database } from 'bun:sqlite';
import { randomUUID } from 'crypto';
import { appendAudit, dbChanges } from '../db';
import { CreateSlotInput as CreateSlotSchema, UpdateSlotInput as UpdateSlotSchema } from '../schemas/market';
import type { CreateSlotInputRaw, UpdateSlotInput } from '../schemas/market';

export interface EventSlot {
  id: string;
  village_id: string;
  zone_id: string | null;
  title: string;
  description: string;
  start_time: string;
  end_time: string;
  capacity: number | null;
  booked: number;
  status: 'open' | 'full' | 'active' | 'ended';
  version: number;
  created_at: string;
  updated_at: string;
}

export interface ListSlotsOptions {
  status?: string;
  zone_id?: string;
}

export class SlotManager {
  constructor(private db: Database) {}

  create(villageId: string, rawInput: CreateSlotInputRaw, actor: string): EventSlot {
    const input = CreateSlotSchema.parse(rawInput);
    const now = new Date().toISOString();
    const slot: EventSlot = {
      id: `slot-${randomUUID()}`,
      village_id: villageId,
      zone_id: input.zone_id ?? null,
      title: input.title,
      description: input.description,
      start_time: input.start_time,
      end_time: input.end_time,
      capacity: input.capacity ?? null,
      booked: 0,
      status: 'open',
      version: 1,
      created_at: now,
      updated_at: now,
    };

    this.db.prepare(`
      INSERT INTO event_slots (id, village_id, zone_id, title, description, start_time, end_time, capacity, booked, status, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      slot.id, slot.village_id, slot.zone_id, slot.title,
      slot.description, slot.start_time, slot.end_time,
      slot.capacity, slot.booked, slot.status,
      slot.version, slot.created_at, slot.updated_at,
    );

    appendAudit(this.db, 'event_slot', slot.id, 'create', slot, actor);
    return slot;
  }

  get(id: string): EventSlot | null {
    const row = this.db.prepare('SELECT * FROM event_slots WHERE id = ?').get(id) as Record<string, unknown> | null;
    return row ? this.deserialize(row) : null;
  }

  list(villageId: string, opts?: ListSlotsOptions): EventSlot[] {
    let sql = 'SELECT * FROM event_slots WHERE village_id = ?';
    const params: string[] = [villageId];

    if (opts?.status) {
      sql += ' AND status = ?';
      params.push(opts.status);
    }
    if (opts?.zone_id) {
      sql += ' AND zone_id = ?';
      params.push(opts.zone_id);
    }

    sql += ' ORDER BY start_time ASC';

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.deserialize(r));
  }

  /**
   * 預訂一個 slot。如果 capacity 已滿，拋出錯誤。
   * 預訂成功時會同時建立一筆 booking order。
   */
  book(id: string, villageId: string, buyer: string, actor: string): EventSlot {
    const existing = this.get(id);
    if (!existing) throw new Error('EventSlot not found');
    if (existing.status === 'full') throw new Error('Slot is full');
    if (existing.status === 'ended') throw new Error('Slot has ended');

    const newBooked = existing.booked + 1;
    const newStatus = (existing.capacity !== null && newBooked >= existing.capacity)
      ? 'full' as const
      : existing.status;

    const now = new Date().toISOString();
    const updated: EventSlot = {
      ...existing,
      booked: newBooked,
      status: newStatus,
      version: existing.version + 1,
      updated_at: now,
    };

    const result = this.db.prepare(`
      UPDATE event_slots SET booked=?, status=?, version=?, updated_at=?
      WHERE id=? AND version=?
    `).run(
      updated.booked, updated.status, updated.version, updated.updated_at,
      id, existing.version,
    );
    if (dbChanges(result) === 0) {
      throw new Error('CONCURRENCY_CONFLICT: version mismatch');
    }

    // 建立 booking order
    const orderId = `order-${randomUUID()}`;
    this.db.prepare(`
      INSERT INTO orders (id, village_id, stall_id, slot_id, buyer, type, amount, status, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      orderId, villageId, null, id, buyer, 'booking', 0, 'confirmed', 1, now, now,
    );

    appendAudit(this.db, 'event_slot', id, 'book', { buyer, booked: newBooked, order_id: orderId }, actor);
    return updated;
  }

  update(id: string, input: UpdateSlotInput, actor: string): EventSlot {
    const parsed = UpdateSlotSchema.parse(input);
    const existing = this.get(id);
    if (!existing) throw new Error('EventSlot not found');

    const now = new Date().toISOString();
    const updated: EventSlot = {
      ...existing,
      ...(parsed.title !== undefined && { title: parsed.title }),
      ...(parsed.description !== undefined && { description: parsed.description }),
      ...(parsed.status !== undefined && { status: parsed.status }),
      version: existing.version + 1,
      updated_at: now,
    };

    const result = this.db.prepare(`
      UPDATE event_slots SET title=?, description=?, status=?, version=?, updated_at=?
      WHERE id=? AND version=?
    `).run(
      updated.title, updated.description, updated.status,
      updated.version, updated.updated_at,
      id, existing.version,
    );
    if (dbChanges(result) === 0) {
      throw new Error('CONCURRENCY_CONFLICT: version mismatch');
    }

    appendAudit(this.db, 'event_slot', id, 'update', { before: existing, after: updated }, actor);
    return updated;
  }

  end(id: string, actor: string): EventSlot {
    return this.update(id, { status: 'ended' }, actor);
  }

  private deserialize(row: Record<string, unknown>): EventSlot {
    return {
      id: row.id as string,
      village_id: row.village_id as string,
      zone_id: (row.zone_id as string) || null,
      title: row.title as string,
      description: row.description as string,
      start_time: row.start_time as string,
      end_time: row.end_time as string,
      capacity: row.capacity !== null ? (row.capacity as number) : null,
      booked: row.booked as number,
      status: row.status as EventSlot['status'],
      version: row.version as number,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    };
  }
}
