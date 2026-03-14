import type { Database } from 'bun:sqlite';
import { randomUUID } from 'crypto';
import { appendAudit } from './db';
import { CreateChiefInput as CreateChiefSchema } from './schemas/chief';
import type { CreateChiefInputRaw, UpdateChiefInput, ChiefPersonality } from './schemas/chief';
import type { ConstitutionStore } from './constitution-store';
import type { SkillRegistry } from './skill-registry';
import { buildSkillPrompt } from './skill-registry';
import type { Permission } from './schemas/constitution';
import type { SkillBinding as SkillBindingType } from './schemas/skill';

export type { ChiefPersonality } from './schemas/chief';

export interface ChiefConstraint {
  type: 'must' | 'must_not' | 'prefer' | 'avoid';
  description: string;
}

export interface Chief {
  id: string;
  village_id: string;
  name: string;
  role: string;
  version: number;
  status: 'active' | 'inactive';
  skills: SkillBindingType[];
  permissions: Permission[];
  personality: ChiefPersonality;
  constraints: ChiefConstraint[];
  created_at: string;
  updated_at: string;
}

export class ChiefEngine {
  constructor(
    private db: Database,
    private constitutionStore: ConstitutionStore,
    private skillRegistry: SkillRegistry,
  ) {}

  create(villageId: string, rawInput: CreateChiefInputRaw, actor: string): Chief {
    const input = CreateChiefSchema.parse(rawInput);

    const constitution = this.constitutionStore.getActive(villageId);
    if (!constitution) {
      throw new Error('No active constitution. Cannot create Chief without a constitution framework.');
    }

    // THY-09: permissions ⊆ constitution.allowed_permissions
    for (const perm of input.permissions) {
      if (!constitution.allowed_permissions.includes(perm)) {
        throw new Error(`PERMISSION_EXCEEDS_CONSTITUTION: "${perm}" not in constitution's allowed_permissions`);
      }
    }

    // THY-14: only verified skills
    this.validateSkillBindings(input.skills, villageId);

    const now = new Date().toISOString();
    const chief: Chief = {
      id: `chief-${randomUUID()}`,
      village_id: villageId,
      name: input.name,
      role: input.role,
      version: 1,
      status: 'active',
      skills: input.skills,
      permissions: input.permissions,
      personality: input.personality,
      constraints: input.constraints,
      created_at: now,
      updated_at: now,
    };

    this.db.prepare(`
      INSERT INTO chiefs (id, village_id, name, role, version, status, skills, permissions, personality, constraints, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      chief.id, villageId, chief.name, chief.role, chief.version, chief.status,
      JSON.stringify(chief.skills), JSON.stringify(chief.permissions),
      JSON.stringify(chief.personality), JSON.stringify(chief.constraints),
      chief.created_at, chief.updated_at,
    );

    appendAudit(this.db, 'chief', chief.id, 'create', chief, actor);
    return chief;
  }

  get(id: string): Chief | null {
    const row = this.db.prepare('SELECT * FROM chiefs WHERE id = ?').get(id) as Record<string, unknown> | null;
    return row ? this.deserialize(row) : null;
  }

  list(villageId: string, opts?: { status?: string }): Chief[] {
    let sql = 'SELECT * FROM chiefs WHERE village_id = ?';
    const params: string[] = [villageId];
    if (opts?.status) {
      sql += ' AND status = ?';
      params.push(opts.status);
    }
    sql += ' ORDER BY created_at DESC';
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.deserialize(r));
  }

  update(id: string, input: UpdateChiefInput, actor: string): Chief {
    const existing = this.get(id);
    if (!existing) throw new Error('Chief not found');

    if (input.permissions) {
      const constitution = this.constitutionStore.getActive(existing.village_id);
      if (!constitution) throw new Error('No active constitution');
      for (const perm of input.permissions) {
        if (!constitution.allowed_permissions.includes(perm)) {
          throw new Error(`PERMISSION_EXCEEDS_CONSTITUTION: "${perm}"`);
        }
      }
    }

    if (input.skills) {
      this.validateSkillBindings(input.skills, existing.village_id);
    }

    const now = new Date().toISOString();
    const updated: Chief = {
      ...existing,
      ...(input.name !== undefined && { name: input.name }),
      ...(input.role !== undefined && { role: input.role }),
      ...(input.skills !== undefined && { skills: input.skills }),
      ...(input.permissions !== undefined && { permissions: input.permissions }),
      ...(input.personality !== undefined && { personality: input.personality }),
      ...(input.constraints !== undefined && { constraints: input.constraints }),
      version: existing.version + 1,
      updated_at: now,
    };

    this.db.prepare(`
      UPDATE chiefs SET name=?, role=?, version=?, skills=?, permissions=?,
        personality=?, constraints=?, updated_at=? WHERE id=?
    `).run(
      updated.name, updated.role, updated.version,
      JSON.stringify(updated.skills), JSON.stringify(updated.permissions),
      JSON.stringify(updated.personality), JSON.stringify(updated.constraints),
      now, id,
    );

    appendAudit(this.db, 'chief', id, 'update', { before: existing, after: updated }, actor);
    return updated;
  }

  deactivate(id: string, actor: string): void {
    const chief = this.get(id);
    if (!chief) throw new Error('Chief not found');
    this.db.prepare('UPDATE chiefs SET status = ?, updated_at = ? WHERE id = ?')
      .run('inactive', new Date().toISOString(), id);
    appendAudit(this.db, 'chief', id, 'deactivate', { previous_status: chief.status }, actor);
  }

  private validateSkillBindings(bindings: SkillBindingType[], villageId: string): void {
    for (const b of bindings) {
      const skill = this.skillRegistry.get(b.skill_id);
      if (!skill) throw new Error(`Skill ${b.skill_id} not found`);
      if (skill.status !== 'verified') {
        throw new Error(`SKILL_NOT_VERIFIED: "${skill.name}" is ${skill.status}, must be verified (THY-14)`);
      }
      if (skill.village_id && skill.village_id !== villageId) {
        // Check if skill is shared to this village via skill_shares
        const shareRow = this.db.prepare(`
          SELECT id FROM skill_shares
          WHERE skill_id = ? AND to_village_id = ? AND status = 'active'
        `).get(b.skill_id, villageId);
        if (!shareRow) {
          throw new Error(`Skill "${skill.name}" belongs to another village`);
        }
      }
    }
  }

  private deserialize(row: Record<string, unknown>): Chief {
    return {
      id: row.id as string,
      village_id: row.village_id as string,
      name: row.name as string,
      role: row.role as string,
      version: row.version as number,
      status: row.status as Chief['status'],
      skills: JSON.parse((row.skills as string) || '[]'),
      permissions: JSON.parse((row.permissions as string) || '[]'),
      personality: JSON.parse((row.personality as string) || '{}'),
      constraints: JSON.parse((row.constraints as string) || '[]'),
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    };
  }
}

/**
 * Build a complete system prompt from Chief config + Skills
 */
export function buildChiefPrompt(chief: Chief, skillRegistry: SkillRegistry): string {
  const lines: string[] = [];

  lines.push(`You are "${chief.name}", a ${chief.role}.`);
  lines.push('');

  // Personality
  const p = chief.personality;
  const personalityMap: Record<string, Record<string, string>> = {
    risk_tolerance: {
      conservative: 'You are risk-averse. When in doubt, choose the safer option.',
      moderate: 'You balance risk and reward. Take calculated risks when evidence supports them.',
      aggressive: 'You are willing to take calculated risks for better outcomes.',
    },
    communication_style: {
      concise: 'Be concise and direct. Lead with conclusions.',
      detailed: 'Provide thorough explanations with evidence.',
      minimal: 'Only communicate essential information.',
    },
    decision_speed: {
      fast: 'Make decisions quickly. Bias toward action.',
      deliberate: 'Take time to consider options. Balance speed with thoroughness.',
      cautious: 'Be thorough and methodical. Double-check before acting.',
    },
  };

  lines.push('## Personality');
  lines.push(personalityMap.risk_tolerance[p.risk_tolerance]);
  lines.push(personalityMap.communication_style[p.communication_style]);
  lines.push(personalityMap.decision_speed[p.decision_speed]);
  lines.push('');

  // Constraints
  if (chief.constraints.length > 0) {
    lines.push('## Constraints');
    const prefixMap = {
      must: 'You MUST',
      must_not: 'You MUST NOT',
      prefer: 'You should prefer to',
      avoid: 'You should avoid',
    };
    for (const c of chief.constraints) {
      lines.push(`- ${prefixMap[c.type]}: ${c.description}`);
    }
    lines.push('');
  }

  // Skills
  if (chief.skills.length > 0) {
    const skillPrompt = buildSkillPrompt(chief.skills, skillRegistry);
    if (skillPrompt) {
      lines.push('## Skills');
      lines.push(skillPrompt);
    }
  }

  return lines.join('\n');
}
