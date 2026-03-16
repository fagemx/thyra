import type { Database } from 'bun:sqlite';
import { randomUUID } from 'crypto';
import { appendAudit } from '../db';
import { CreateZoneInput as CreateZoneSchema, UpdateZoneInput as UpdateZoneSchema } from '../schemas/market';
import type { CreateZoneInput, UpdateZoneInput } from '../schemas/market';

export interface Zone {
  id: string;
  village_id: string;
  name: string;
  type: 'main_street' | 'side_alley' | 'stage' | 'entrance';
  capacity: number;
  current_load: number;
  status: 'active' | 'closed';
  version: number;
  created_at: string;
  updated_at: string;
}

export class ZoneManager {
  constructor(private db: Database) {}

  create(villageId: string, input: CreateZoneInput, actor: string): Zone {
    const parsed = CreateZoneSchema.parse(input);
    const now = new Date().toISOString();
    const zone: Zone = {
      id: `zone-${randomUUID()}`,
      village_id: villageId,
      name: parsed.name,
      type: parsed.type,
      capacity: parsed.capacity,
      current_load: 0,
      status: 'active',
      version: 1,
      created_at: now,
      updated_at: now,
    };

    this.db.prepare(`
      INSERT INTO zones (id, village_id, name, type, capacity, current_load, status, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      zone.id, zone.village_id, zone.name, zone.type,
      zone.capacity, zone.current_load, zone.status,
      zone.version, zone.created_at, zone.updated_at,
    );

    appendAudit(this.db, 'zone', zone.id, 'create', zone, actor);
    return zone;
  }

  get(id: string): Zone | null {
    const row = this.db.prepare('SELECT * FROM zones WHERE id = ?').get(id) as Record<string, unknown> | null;
    return row ? this.deserialize(row) : null;
  }

  list(villageId: string): Zone[] {
    const rows = this.db.prepare(
      'SELECT * FROM zones WHERE village_id = ? ORDER BY created_at DESC',
    ).all(villageId) as Record<string, unknown>[];
    return rows.map((r) => this.deserialize(r));
  }

  update(id: string, input: UpdateZoneInput, actor: string): Zone {
    const parsed = UpdateZoneSchema.parse(input);
    const existing = this.get(id);
    if (!existing) throw new Error('Zone not found');

    const now = new Date().toISOString();
    const updated: Zone = {
      ...existing,
      ...(parsed.name !== undefined && { name: parsed.name }),
      ...(parsed.capacity !== undefined && { capacity: parsed.capacity }),
      ...(parsed.status !== undefined && { status: parsed.status }),
      version: existing.version + 1,
      updated_at: now,
    };

    const result = this.db.prepare(`
      UPDATE zones SET name=?, capacity=?, status=?, version=?, updated_at=?
      WHERE id=? AND version=?
    `).run(
      updated.name, updated.capacity, updated.status,
      updated.version, updated.updated_at,
      id, existing.version,
    );
    if ((result as { changes: number }).changes === 0) {
      throw new Error('CONCURRENCY_CONFLICT: version mismatch');
    }

    appendAudit(this.db, 'zone', id, 'update', { before: existing, after: updated }, actor);
    return updated;
  }

  /**
   * 原子性增減 zone 的 current_load。
   * delta 可正可負。結果不會低於 0。
   */
  updateLoad(id: string, delta: number, actor: string): Zone {
    const existing = this.get(id);
    if (!existing) throw new Error('Zone not found');

    const newLoad = Math.max(0, existing.current_load + delta);
    const now = new Date().toISOString();
    const updated: Zone = {
      ...existing,
      current_load: newLoad,
      version: existing.version + 1,
      updated_at: now,
    };

    const result = this.db.prepare(`
      UPDATE zones SET current_load=?, version=?, updated_at=?
      WHERE id=? AND version=?
    `).run(
      updated.current_load, updated.version, updated.updated_at,
      id, existing.version,
    );
    if ((result as { changes: number }).changes === 0) {
      throw new Error('CONCURRENCY_CONFLICT: version mismatch');
    }

    appendAudit(this.db, 'zone', id, 'update_load', { before: existing.current_load, after: newLoad, delta }, actor);
    return updated;
  }

  close(id: string, actor: string): Zone {
    return this.update(id, { status: 'closed' }, actor);
  }

  private deserialize(row: Record<string, unknown>): Zone {
    return {
      id: row.id as string,
      village_id: row.village_id as string,
      name: row.name as string,
      type: row.type as Zone['type'],
      capacity: row.capacity as number,
      current_load: row.current_load as number,
      status: row.status as Zone['status'],
      version: row.version as number,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    };
  }
}
