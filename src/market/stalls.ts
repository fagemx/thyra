import type { Database } from 'bun:sqlite';
import { randomUUID } from 'crypto';
import { appendAudit, dbChanges } from '../db';
import { CreateStallInput as CreateStallSchema, UpdateStallInput as UpdateStallSchema } from '../schemas/market';
import type { CreateStallInputRaw, UpdateStallInput } from '../schemas/market';

export interface Stall {
  id: string;
  village_id: string;
  zone_id: string;
  name: string;
  owner: string | null;
  category: string | null;
  rank: number;
  status: 'active' | 'spotlight' | 'closed';
  metadata: Record<string, unknown>;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface ListStallsOptions {
  zone_id?: string;
  status?: string;
  sort_by?: 'rank' | 'created_at';
}

export class StallManager {
  constructor(private db: Database) {}

  create(villageId: string, rawInput: CreateStallInputRaw, actor: string): Stall {
    const input = CreateStallSchema.parse(rawInput);
    const now = new Date().toISOString();
    const stall: Stall = {
      id: `stall-${randomUUID()}`,
      village_id: villageId,
      zone_id: input.zone_id,
      name: input.name,
      owner: input.owner ?? null,
      category: input.category ?? null,
      rank: 0,
      status: 'active',
      metadata: input.metadata,
      version: 1,
      created_at: now,
      updated_at: now,
    };

    this.db.prepare(`
      INSERT INTO stalls (id, village_id, zone_id, name, owner, category, rank, status, metadata, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      stall.id, stall.village_id, stall.zone_id, stall.name,
      stall.owner, stall.category, stall.rank, stall.status,
      JSON.stringify(stall.metadata), stall.version,
      stall.created_at, stall.updated_at,
    );

    appendAudit(this.db, 'stall', stall.id, 'create', stall, actor);
    return stall;
  }

  get(id: string): Stall | null {
    const row = this.db.prepare('SELECT * FROM stalls WHERE id = ?').get(id) as Record<string, unknown> | null;
    return row ? this.deserialize(row) : null;
  }

  list(villageId: string, opts?: ListStallsOptions): Stall[] {
    let sql = 'SELECT * FROM stalls WHERE village_id = ?';
    const params: string[] = [villageId];

    if (opts?.zone_id) {
      sql += ' AND zone_id = ?';
      params.push(opts.zone_id);
    }
    if (opts?.status) {
      sql += ' AND status = ?';
      params.push(opts.status);
    }

    const sortBy = opts?.sort_by ?? 'created_at';
    if (sortBy === 'rank') {
      sql += ' ORDER BY rank DESC, created_at DESC';
    } else {
      sql += ' ORDER BY created_at DESC';
    }

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.deserialize(r));
  }

  update(id: string, input: UpdateStallInput, actor: string): Stall {
    const parsed = UpdateStallSchema.parse(input);
    const existing = this.get(id);
    if (!existing) throw new Error('Stall not found');

    const now = new Date().toISOString();
    const updated: Stall = {
      ...existing,
      ...(parsed.name !== undefined && { name: parsed.name }),
      ...(parsed.owner !== undefined && { owner: parsed.owner }),
      ...(parsed.category !== undefined && { category: parsed.category }),
      ...(parsed.rank !== undefined && { rank: parsed.rank }),
      ...(parsed.status !== undefined && { status: parsed.status }),
      ...(parsed.metadata !== undefined && { metadata: parsed.metadata }),
      version: existing.version + 1,
      updated_at: now,
    };

    const result = this.db.prepare(`
      UPDATE stalls SET name=?, owner=?, category=?, rank=?, status=?, metadata=?, version=?, updated_at=?
      WHERE id=? AND version=?
    `).run(
      updated.name, updated.owner, updated.category, updated.rank,
      updated.status, JSON.stringify(updated.metadata),
      updated.version, updated.updated_at,
      id, existing.version,
    );
    if (dbChanges(result) === 0) {
      throw new Error('CONCURRENCY_CONFLICT: version mismatch');
    }

    appendAudit(this.db, 'stall', id, 'update', { before: existing, after: updated }, actor);
    return updated;
  }

  /**
   * 調整 stall 的 rank（加 delta）。
   */
  updateRank(id: string, delta: number, actor: string): Stall {
    const existing = this.get(id);
    if (!existing) throw new Error('Stall not found');
    return this.update(id, { rank: existing.rank + delta }, actor);
  }

  /**
   * 將 stall 設為 spotlight 狀態。
   */
  spotlight(id: string, actor: string): Stall {
    return this.update(id, { status: 'spotlight' }, actor);
  }

  /**
   * 關閉 stall。
   */
  close(id: string, actor: string): Stall {
    return this.update(id, { status: 'closed' }, actor);
  }

  private deserialize(row: Record<string, unknown>): Stall {
    return {
      id: row.id as string,
      village_id: row.village_id as string,
      zone_id: row.zone_id as string,
      name: row.name as string,
      owner: (row.owner as string) || null,
      category: (row.category as string) || null,
      rank: row.rank as number,
      status: row.status as Stall['status'],
      metadata: JSON.parse((row.metadata as string) || '{}') as Record<string, unknown>,
      version: row.version as number,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    };
  }
}
