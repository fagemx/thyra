import type { Database } from 'bun:sqlite';
import { randomUUID } from 'crypto';
import { appendAudit } from './db';
import { CreateVillageInput as CreateVillageSchema, SetBoardMappingInput as SetBoardMappingSchema } from './schemas/village';
import type { CreateVillageInputRaw, UpdateVillageInput, SetBoardMappingInput } from './schemas/village';

export interface BoardMapping {
  id: string;
  village_id: string;
  board_namespace: string;
  karvi_url: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface Village {
  id: string;
  name: string;
  description: string;
  target_repo: string;
  status: 'active' | 'paused' | 'archived';
  metadata: Record<string, unknown>;
  version: number;
  created_at: string;
  updated_at: string;
}

export class VillageManager {
  constructor(private db: Database) {}

  create(rawInput: CreateVillageInputRaw, actor: string): Village {
    const input = CreateVillageSchema.parse(rawInput);
    const now = new Date().toISOString();
    const village: Village = {
      id: `village-${randomUUID()}`,
      name: input.name,
      description: input.description,
      target_repo: input.target_repo,
      status: 'active',
      metadata: input.metadata,
      version: 1,
      created_at: now,
      updated_at: now,
    };

    this.db.prepare(`
      INSERT INTO villages (id, name, description, target_repo, status, metadata, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      village.id, village.name, village.description, village.target_repo,
      village.status, JSON.stringify(village.metadata), village.version,
      village.created_at, village.updated_at
    );

    appendAudit(this.db, 'village', village.id, 'create', village, actor);
    return village;
  }

  get(id: string): Village | null {
    const row = this.db.prepare('SELECT * FROM villages WHERE id = ?').get(id) as Record<string, unknown> | null;
    return row ? this.deserialize(row) : null;
  }

  list(filters?: { status?: string }): Village[] {
    let sql = 'SELECT * FROM villages';
    const params: string[] = [];
    if (filters?.status) {
      sql += ' WHERE status = ?';
      params.push(filters.status);
    }
    sql += ' ORDER BY created_at DESC';
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.deserialize(r));
  }

  update(id: string, input: UpdateVillageInput, actor: string): Village {
    const existing = this.get(id);
    if (!existing) throw new Error('Village not found');

    const now = new Date().toISOString();
    const updated: Village = {
      ...existing,
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.target_repo !== undefined && { target_repo: input.target_repo }),
      ...(input.status !== undefined && { status: input.status }),
      ...(input.metadata !== undefined && { metadata: input.metadata }),
      version: existing.version + 1,
      updated_at: now,
    };

    const result = this.db.prepare(`
      UPDATE villages SET name=?, description=?, target_repo=?, status=?,
        metadata=?, version=?, updated_at=? WHERE id=? AND version=?
    `).run(
      updated.name, updated.description, updated.target_repo, updated.status,
      JSON.stringify(updated.metadata), updated.version, updated.updated_at, id,
      existing.version,
    );
    if ((result as { changes: number }).changes === 0) {
      throw new Error('CONCURRENCY_CONFLICT: version mismatch');
    }

    appendAudit(this.db, 'village', id, 'update', { before: existing, after: updated }, actor);
    return updated;
  }

  archive(id: string, actor: string): void {
    this.update(id, { status: 'archived' }, actor);
  }

  /**
   * 設定 village 的 Karvi board 映射。
   * 如果已存在映射，則更新（version +1）。
   */
  setBoardMapping(villageId: string, input: SetBoardMappingInput, actor: string): BoardMapping {
    const parsed = SetBoardMappingSchema.parse(input);
    const existing = this.get(villageId);
    if (!existing) throw new Error('Village not found');

    const now = new Date().toISOString();
    const current = this.getBoardMapping(villageId);

    if (current) {
      // 更新
      const updated: BoardMapping = {
        ...current,
        board_namespace: parsed.board_namespace,
        karvi_url: parsed.karvi_url ?? current.karvi_url,
        version: current.version + 1,
        updated_at: now,
      };

      const result = this.db.prepare(`
        UPDATE board_mappings SET board_namespace=?, karvi_url=?, version=?, updated_at=?
        WHERE id=? AND version=?
      `).run(
        updated.board_namespace, updated.karvi_url, updated.version, updated.updated_at,
        current.id, current.version,
      );
      if ((result as { changes: number }).changes === 0) {
        throw new Error('CONCURRENCY_CONFLICT: version mismatch');
      }

      appendAudit(this.db, 'board_mapping', current.id, 'update', { before: current, after: updated }, actor);
      return updated;
    }

    // 新增
    const mapping: BoardMapping = {
      id: `bmap-${randomUUID()}`,
      village_id: villageId,
      board_namespace: parsed.board_namespace,
      karvi_url: parsed.karvi_url ?? null,
      version: 1,
      created_at: now,
      updated_at: now,
    };

    this.db.prepare(`
      INSERT INTO board_mappings (id, village_id, board_namespace, karvi_url, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      mapping.id, mapping.village_id, mapping.board_namespace,
      mapping.karvi_url, mapping.version, mapping.created_at, mapping.updated_at,
    );

    appendAudit(this.db, 'board_mapping', mapping.id, 'create', mapping, actor);
    return mapping;
  }

  /**
   * 取得 village 的 board 映射。
   */
  getBoardMapping(villageId: string): BoardMapping | null {
    const row = this.db.prepare(
      'SELECT * FROM board_mappings WHERE village_id = ?'
    ).get(villageId) as Record<string, unknown> | null;
    return row ? this.deserializeBoardMapping(row) : null;
  }

  /**
   * 移除 village 的 board 映射。
   */
  removeBoardMapping(villageId: string, actor: string): boolean {
    const existing = this.getBoardMapping(villageId);
    if (!existing) return false;

    this.db.prepare('DELETE FROM board_mappings WHERE village_id = ?').run(villageId);
    appendAudit(this.db, 'board_mapping', existing.id, 'remove', existing, actor);
    return true;
  }

  /**
   * 列出所有 board 映射。
   */
  listBoardMappings(): BoardMapping[] {
    const rows = this.db.prepare(
      'SELECT * FROM board_mappings ORDER BY created_at DESC'
    ).all() as Record<string, unknown>[];
    return rows.map((r) => this.deserializeBoardMapping(r));
  }

  private deserializeBoardMapping(row: Record<string, unknown>): BoardMapping {
    return {
      id: row.id as string,
      village_id: row.village_id as string,
      board_namespace: row.board_namespace as string,
      karvi_url: (row.karvi_url as string) || null,
      version: row.version as number,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    };
  }

  private deserialize(row: Record<string, unknown>): Village {
    return {
      id: row.id as string,
      name: row.name as string,
      description: row.description as string,
      target_repo: row.target_repo as string,
      status: row.status as Village['status'],
      metadata: JSON.parse((row.metadata as string) || '{}') as Record<string, unknown>,
      version: row.version as number,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    };
  }
}
