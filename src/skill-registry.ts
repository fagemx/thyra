import type { Database } from 'bun:sqlite';
import { randomUUID } from 'crypto';
import { escapeLikePattern } from './cross-layer';
import { appendAudit } from './db';
import { CreateSkillInput as CreateSkillSchema } from './schemas/skill';
import type { CreateSkillInputRaw, SkillDefinition, UpdateSkillInput, SkillBinding, SourceType, ScopeType } from './schemas/skill';

export interface Skill {
  id: string;
  name: string;
  version: number;
  status: 'draft' | 'verified' | 'deprecated';
  village_id: string | null;
  definition: SkillDefinition;
  created_at: string;
  updated_at: string;
  verified_at: string | null;
  verified_by: string | null;
  content: string | null;
  source_type: SourceType;
  source_origin: string | null;
  source_author: string | null;
  forked_from: string | null;
  scope_type: ScopeType;
  team_id: string | null;
  tags: string[];
  used_count: number;
  last_used_at: string | null;
}

export class SkillRegistry {
  constructor(private db: Database) {}

  create(rawInput: CreateSkillInputRaw, actor: string): Skill {
    const input = CreateSkillSchema.parse(rawInput);
    const now = new Date().toISOString();
    const skill: Skill = {
      id: `skill-${randomUUID()}`,
      name: input.name,
      version: 1,
      status: 'draft',
      village_id: input.village_id ?? null,
      definition: input.definition,
      created_at: now,
      updated_at: now,
      verified_at: null,
      verified_by: null,
      content: input.content ?? null,
      source_type: input.source_type,
      source_origin: input.source_origin ?? null,
      source_author: actor,
      forked_from: input.forked_from ?? null,
      scope_type: input.scope_type,
      team_id: input.team_id ?? null,
      tags: input.tags,
      used_count: 0,
      last_used_at: null,
    };

    this.db.prepare(`
      INSERT INTO skills (id, name, version, status, village_id, definition, created_at, updated_at,
        content, source_type, source_origin, source_author, forked_from, scope_type, team_id, tags, used_count, last_used_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      skill.id, skill.name, skill.version, skill.status,
      skill.village_id, JSON.stringify(skill.definition),
      skill.created_at, skill.updated_at,
      skill.content, skill.source_type, skill.source_origin, skill.source_author,
      skill.forked_from, skill.scope_type, skill.team_id,
      JSON.stringify(skill.tags), skill.used_count, skill.last_used_at
    );

    appendAudit(this.db, 'skill', skill.id, 'create', skill, actor);
    return skill;
  }

  get(id: string): Skill | null {
    const row = this.db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as Record<string, unknown> | null;
    return row ? this.deserialize(row) : null;
  }

  getByNameVersion(name: string, version: number, villageId?: string): Skill | null {
    let sql = 'SELECT * FROM skills WHERE name = ? AND version = ?';
    const params: (string | number)[] = [name, version];
    if (villageId) {
      sql += ' AND (village_id = ? OR village_id IS NULL)';
      params.push(villageId);
    }
    const row = this.db.prepare(sql).get(...params) as Record<string, unknown> | null;
    return row ? this.deserialize(row) : null;
  }

  list(filters?: {
    village_id?: string;
    status?: string;
    name?: string;
    scope_type?: string;
    source_type?: string;
    tags?: string[];
    search?: string;
  }): Skill[] {
    let sql = 'SELECT * FROM skills WHERE 1=1';
    const params: string[] = [];
    if (filters?.village_id) {
      sql += ' AND (village_id = ? OR village_id IS NULL)';
      params.push(filters.village_id);
    }
    if (filters?.status) {
      sql += ' AND status = ?';
      params.push(filters.status);
    }
    if (filters?.name) {
      sql += ' AND name = ?';
      params.push(filters.name);
    }
    if (filters?.scope_type) {
      sql += ' AND scope_type = ?';
      params.push(filters.scope_type);
    }
    if (filters?.source_type) {
      sql += ' AND source_type = ?';
      params.push(filters.source_type);
    }
    if (filters?.tags && filters.tags.length > 0) {
      for (const tag of filters.tags) {
        sql += " AND tags LIKE ? ESCAPE '\\'";
        params.push(`%"${escapeLikePattern(tag)}"%`);
      }
    }
    if (filters?.search) {
      sql += ` AND (name LIKE ? ESCAPE '\\' OR json_extract(definition, '$.description') LIKE ? ESCAPE '\\')`;
      params.push(`%${escapeLikePattern(filters.search)}%`, `%${escapeLikePattern(filters.search)}%`);
    }
    sql += ' ORDER BY name, version DESC';
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.deserialize(r));
  }

  /**
   * 根據 name 解析 skill，scope cascade：village → global。
   * 回傳最新版本（不限 status），用於 content API。
   */
  getByNameWithScope(name: string, villageId?: string): Skill | null {
    if (villageId) {
      const villageRow = this.db.prepare(`
        SELECT * FROM skills WHERE name = ? AND scope_type = 'village' AND village_id = ?
        ORDER BY version DESC LIMIT 1
      `).get(name, villageId) as Record<string, unknown> | null;
      if (villageRow) return this.deserialize(villageRow);
    }
    const globalRow = this.db.prepare(`
      SELECT * FROM skills WHERE name = ? AND scope_type = 'global'
      ORDER BY version DESC LIMIT 1
    `).get(name) as Record<string, unknown> | null;
    return globalRow ? this.deserialize(globalRow) : null;
  }

  /**
   * 就地更新 skill content（不建新版本）。
   * Content 是文件性質，非功能變更，不需要 version bump。
   */
  updateContent(id: string, content: string, actor: string): Skill {
    const skill = this.get(id);
    if (!skill) throw new Error('Skill not found');

    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE skills SET content = ?, updated_at = ? WHERE id = ?
    `).run(content, now, id);

    appendAudit(this.db, 'skill', id, 'update_content', { content_length: content.length }, actor);
    return { ...skill, content, updated_at: now };
  }

  update(id: string, input: UpdateSkillInput, actor: string): Skill {
    const existing = this.get(id);
    if (!existing) throw new Error('Skill not found');

    const now = new Date().toISOString();
    const newSkill: Skill = {
      id: `skill-${randomUUID()}`,
      name: existing.name,
      version: existing.version + 1,
      status: 'draft',
      village_id: existing.village_id,
      definition: input.definition
        ? { ...existing.definition, ...input.definition }
        : existing.definition,
      created_at: now,
      updated_at: now,
      verified_at: null,
      verified_by: null,
      content: input.content !== undefined ? input.content : existing.content,
      source_type: existing.source_type,
      source_origin: existing.source_origin,
      source_author: existing.source_author,
      forked_from: existing.forked_from,
      scope_type: input.scope_type ?? existing.scope_type,
      team_id: input.team_id !== undefined ? input.team_id : existing.team_id,
      tags: input.tags ?? existing.tags,
      used_count: 0,
      last_used_at: null,
    };

    this.db.prepare(`
      INSERT INTO skills (id, name, version, status, village_id, definition, created_at, updated_at,
        content, source_type, source_origin, source_author, forked_from, scope_type, team_id, tags, used_count, last_used_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      newSkill.id, newSkill.name, newSkill.version, newSkill.status,
      newSkill.village_id, JSON.stringify(newSkill.definition),
      newSkill.created_at, newSkill.updated_at,
      newSkill.content, newSkill.source_type, newSkill.source_origin, newSkill.source_author,
      newSkill.forked_from, newSkill.scope_type, newSkill.team_id,
      JSON.stringify(newSkill.tags), newSkill.used_count, newSkill.last_used_at
    );

    appendAudit(this.db, 'skill', newSkill.id, 'update', { from: id, to: newSkill.id }, actor);
    return newSkill;
  }

  verify(id: string, actor: string): Skill {
    const skill = this.get(id);
    if (!skill) throw new Error('Skill not found');
    if (skill.status !== 'draft') throw new Error(`Cannot verify skill in ${skill.status} status`);

    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE skills SET status = 'verified', verified_at = ?, verified_by = ?, updated_at = ? WHERE id = ?
    `).run(now, actor, now, id);

    appendAudit(this.db, 'skill', id, 'verify', { actor }, actor);
    return { ...skill, status: 'verified', verified_at: now, verified_by: actor, updated_at: now };
  }

  deprecate(id: string, actor: string): Skill {
    const skill = this.get(id);
    if (!skill) throw new Error('Skill not found');

    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE skills SET status = 'deprecated', updated_at = ? WHERE id = ?
    `).run(now, id);

    appendAudit(this.db, 'skill', id, 'deprecate', { actor }, actor);
    return { ...skill, status: 'deprecated', updated_at: now };
  }

  /**
   * 記錄 skill 使用次數（usage tracking）
   */
  recordUsage(id: string): void {
    this.db.prepare(`
      UPDATE skills SET used_count = used_count + 1, last_used_at = ? WHERE id = ?
    `).run(new Date().toISOString(), id);
  }

  /**
   * 根據 taskKey（skill name）解析最適合的已驗證 Skill。
   * 查詢範圍：village-specific + global（village_id IS NULL）+ skill_shares。
   * 回傳最新版本，或 null。
   */
  resolveForIntent(taskKey: string, villageId: string): Skill | null {
    const row = this.db.prepare(`
      SELECT * FROM skills
      WHERE name = ? AND status = 'verified'
        AND (village_id = ? OR village_id IS NULL)
      UNION
      SELECT s.* FROM skills s
        INNER JOIN skill_shares ss ON ss.skill_id = s.id
      WHERE s.name = ? AND s.status = 'verified'
        AND ss.to_village_id = ? AND ss.status = 'active'
      ORDER BY version DESC LIMIT 1
    `).get(taskKey, villageId, taskKey, villageId) as Record<string, unknown> | null;
    return row ? this.deserialize(row) : null;
  }

  getAvailable(villageId: string): Skill[] {
    const rows = this.db.prepare(`
      SELECT * FROM skills
      WHERE (village_id = ? OR village_id IS NULL)
        AND status = 'verified'
      UNION
      SELECT s.* FROM skills s
        INNER JOIN skill_shares ss ON ss.skill_id = s.id
      WHERE ss.to_village_id = ?
        AND ss.status = 'active'
        AND s.status = 'verified'
      ORDER BY name, version DESC
    `).all(villageId, villageId) as Record<string, unknown>[];
    return rows.map((r) => this.deserialize(r));
  }

  private deserialize(row: Record<string, unknown>): Skill {
    return {
      id: row.id as string,
      name: row.name as string,
      version: row.version as number,
      status: row.status as Skill['status'],
      village_id: (row.village_id as string) || null,
      definition: JSON.parse(row.definition as string) as Skill['definition'],
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
      verified_at: (row.verified_at as string) || null,
      verified_by: (row.verified_by as string) || null,
      content: (row.content as string) || null,
      source_type: (row.source_type as SourceType | null) ?? 'system',
      source_origin: (row.source_origin as string) || null,
      source_author: (row.source_author as string) || null,
      forked_from: (row.forked_from as string) || null,
      scope_type: (row.scope_type as ScopeType | null) ?? 'global',
      team_id: (row.team_id as string) || null,
      tags: JSON.parse((row.tags as string) || '[]') as string[],
      used_count: (row.used_count as number) || 0,
      last_used_at: (row.last_used_at as string) || null,
    };
  }
}

/**
 * Validate skill bindings for a Chief (THY-14)
 */
export function validateSkillBindings(
  bindings: SkillBinding[],
  villageId: string,
  registry: SkillRegistry,
  db?: Database,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  for (const b of bindings) {
    const skill = registry.get(b.skill_id);
    if (!skill) {
      errors.push(`Skill ${b.skill_id} not found`);
      continue;
    }
    if (skill.status !== 'verified') {
      errors.push(`Skill ${skill.name} is ${skill.status}, must be verified (THY-14)`);
    }
    if (skill.village_id && skill.village_id !== villageId) {
      // Check if skill is shared to this village via skill_shares
      let isShared = false;
      if (db) {
        const shareRow = db.prepare(`
          SELECT id FROM skill_shares
          WHERE skill_id = ? AND to_village_id = ? AND status = 'active'
        `).get(b.skill_id, villageId);
        isShared = !!shareRow;
      }
      if (!isShared) {
        errors.push(`Skill ${skill.name} belongs to another village`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Build combined skill prompt for a Chief's bound skills
 */
export function buildSkillPrompt(bindings: SkillBinding[], registry: SkillRegistry): string {
  const sections: string[] = [];
  for (const b of bindings) {
    const skill = registry.get(b.skill_id);
    if (!skill) continue;
    sections.push(`## Skill: ${skill.name} (v${b.skill_version})`);
    sections.push(skill.definition.prompt_template);
    if (skill.definition.constraints.length) {
      sections.push('Constraints:');
      sections.push(skill.definition.constraints.map((c) => `- ${c}`).join('\n'));
    }
  }
  return sections.join('\n\n');
}
