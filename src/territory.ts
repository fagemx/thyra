import type { Database } from 'bun:sqlite';
import { randomUUID } from 'crypto';
import { appendAudit } from './db';
import type { ConstitutionStore } from './constitution-store';
import type { SkillRegistry } from './skill-registry';
import { CreateTerritoryInput as CreateTerritorySchema, CreateAgreementInput as CreateAgreementSchema, ShareSkillInput as ShareSkillSchema } from './schemas/territory';
import type { CreateTerritoryInputRaw, CreateAgreementInputRaw, ShareSkillInputRaw } from './schemas/territory';

export interface Territory {
  id: string;
  name: string;
  village_ids: string[];
  status: 'active' | 'dissolved';
  version: number;
  created_at: string;
  updated_at: string;
}

export interface Agreement {
  id: string;
  territory_id: string;
  type: 'resource_sharing' | 'law_template' | 'chief_lending' | 'budget_pool';
  parties: string[];
  terms: Record<string, unknown>;
  approved_by: Record<string, string>;
  status: 'pending' | 'active' | 'revoked';
  version: number;
  created_at: string;
  updated_at: string;
}

export class TerritoryCoordinator {
  constructor(
    private db: Database,
    private constitutionStore: ConstitutionStore,
    private skillRegistry: SkillRegistry,
  ) {}

  create(rawInput: CreateTerritoryInputRaw, actor: string): Territory {
    const input = CreateTerritorySchema.parse(rawInput);

    // SI-7: Both constitutions must allow cross_village
    for (const vid of input.village_ids) {
      const constitution = this.constitutionStore.getActive(vid);
      if (!constitution) {
        throw new Error(`Village ${vid} has no active constitution`);
      }
      if (!constitution.allowed_permissions.includes('cross_village')) {
        throw new Error(`CONSTITUTION_FORBIDS_CROSS_VILLAGE: Village ${vid} constitution does not allow cross_village`);
      }
    }

    const now = new Date().toISOString();
    const territory: Territory = {
      id: `territory-${randomUUID()}`,
      name: input.name,
      village_ids: input.village_ids,
      status: 'active',
      version: 1,
      created_at: now,
      updated_at: now,
    };

    this.db.prepare(`
      INSERT INTO territories (id, name, village_ids, status, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(territory.id, territory.name, JSON.stringify(territory.village_ids), territory.status, territory.version, now, now);

    appendAudit(this.db, 'territory', territory.id, 'create', { village_ids: input.village_ids }, actor);
    return territory;
  }

  get(id: string): Territory | null {
    const row = this.db.prepare('SELECT * FROM territories WHERE id = ?').get(id) as Record<string, unknown> | null;
    return row ? this.deserializeTerritory(row) : null;
  }

  list(opts?: { status?: string }): Territory[] {
    let sql = 'SELECT * FROM territories';
    const params: string[] = [];
    if (opts?.status) {
      sql += ' WHERE status = ?';
      params.push(opts.status);
    }
    sql += ' ORDER BY created_at DESC';
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.deserializeTerritory(r));
  }

  dissolve(id: string, actor: string): Territory {
    const territory = this.get(id);
    if (!territory || territory.status !== 'active') throw new Error('Territory not found or not active');

    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare('UPDATE territories SET status = ?, updated_at = ? WHERE id = ?')
        .run('dissolved', now, id);

      // Revoke all active agreements
      this.db.prepare("UPDATE agreements SET status = 'revoked', updated_at = ? WHERE territory_id = ? AND status IN ('pending', 'active')")
        .run(now, id);

      // Revoke all active skill shares
      this.db.prepare("UPDATE skill_shares SET status = 'revoked' WHERE territory_id = ? AND status = 'active'")
        .run(id);

      appendAudit(this.db, 'territory', id, 'dissolve', {}, actor);
    })();
    return { ...territory, status: 'dissolved', updated_at: now };
  }

  // === Agreements ===

  createAgreement(territoryId: string, rawInput: CreateAgreementInputRaw, actor: string): Agreement {
    const input = CreateAgreementSchema.parse(rawInput);

    const territory = this.get(territoryId);
    if (!territory || territory.status !== 'active') throw new Error('Territory not found or not active');

    // All parties must be in the territory
    for (const partyId of input.parties) {
      if (!territory.village_ids.includes(partyId)) {
        throw new Error(`Village ${partyId} is not a member of this territory`);
      }
    }

    const now = new Date().toISOString();
    const agreement: Agreement = {
      id: `agreement-${randomUUID()}`,
      territory_id: territoryId,
      type: input.type,
      parties: input.parties,
      terms: input.terms,
      approved_by: {},
      status: 'pending',
      version: 1,
      created_at: now,
      updated_at: now,
    };

    this.db.prepare(`
      INSERT INTO agreements (id, territory_id, type, parties, terms, approved_by, status, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(agreement.id, territoryId, agreement.type, JSON.stringify(agreement.parties),
      JSON.stringify(agreement.terms), '{}', agreement.status, agreement.version, now, now);

    appendAudit(this.db, 'agreement', agreement.id, 'create', { type: input.type, parties: input.parties }, actor);
    return agreement;
  }

  approveAgreement(agreementId: string, villageId: string, actor: string): Agreement {
    const agreement = this.getAgreement(agreementId);
    if (!agreement || agreement.status !== 'pending') throw new Error('Agreement not found or not pending');

    if (!agreement.parties.includes(villageId)) {
      throw new Error('Village is not a party to this agreement');
    }

    const approvedBy = { ...agreement.approved_by, [villageId]: actor };
    const now = new Date().toISOString();

    // Check if all parties approved
    const allApproved = agreement.parties.every((p) => approvedBy[p]);
    const newStatus = allApproved ? 'active' : 'pending';

    this.db.prepare('UPDATE agreements SET approved_by = ?, status = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(approvedBy), newStatus, now, agreementId);

    appendAudit(this.db, 'agreement', agreementId, 'approve', { village_id: villageId, all_approved: allApproved }, actor);
    return { ...agreement, approved_by: approvedBy, status: newStatus, updated_at: now };
  }

  getAgreement(id: string): Agreement | null {
    const row = this.db.prepare('SELECT * FROM agreements WHERE id = ?').get(id) as Record<string, unknown> | null;
    return row ? this.deserializeAgreement(row) : null;
  }

  listAgreements(territoryId: string, opts?: { status?: string }): Agreement[] {
    let sql = 'SELECT * FROM agreements WHERE territory_id = ?';
    const params: string[] = [territoryId];
    if (opts?.status) {
      sql += ' AND status = ?';
      params.push(opts.status);
    }
    sql += ' ORDER BY created_at DESC';
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.deserializeAgreement(r));
  }

  // === Skill Sharing ===

  shareSkill(rawInput: ShareSkillInputRaw, actor: string): { shared: boolean; message: string } {
    const input = ShareSkillSchema.parse(rawInput);

    // Check territory exists between the two villages
    const territories = this.list({ status: 'active' });
    const sharedTerritory = territories.find((t) =>
      t.village_ids.includes(input.from_village_id) && t.village_ids.includes(input.to_village_id),
    );
    if (!sharedTerritory) {
      throw new Error('No active territory between these villages');
    }

    // Check active resource_sharing agreement
    const agreements = this.listAgreements(sharedTerritory.id, { status: 'active' });
    const sharingAgreement = agreements.find((a) =>
      a.type === 'resource_sharing' &&
      a.parties.includes(input.from_village_id) &&
      a.parties.includes(input.to_village_id),
    );
    if (!sharingAgreement) {
      throw new Error('No active resource_sharing agreement between these villages');
    }

    // Check skill is verified
    const skill = this.skillRegistry.get(input.skill_id);
    if (!skill) throw new Error('Skill not found');
    if (skill.status !== 'verified') throw new Error('Skill must be verified to share');
    if (skill.village_id !== input.from_village_id) throw new Error('Skill does not belong to source village');

    // Idempotent: check if already shared
    const existing = this.db.prepare(`
      SELECT id FROM skill_shares
      WHERE skill_id = ? AND to_village_id = ? AND territory_id = ? AND status = 'active'
    `).get(input.skill_id, input.to_village_id, sharedTerritory.id) as Record<string, unknown> | null;

    if (existing) {
      return { shared: true, message: `Skill "${skill.name}" already shared to ${input.to_village_id}` };
    }

    // Insert skill share record
    const shareId = `skill-share-${randomUUID()}`;
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO skill_shares (id, skill_id, from_village_id, to_village_id, territory_id, agreement_id, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?)
    `).run(shareId, input.skill_id, input.from_village_id, input.to_village_id, sharedTerritory.id, sharingAgreement.id, now);

    appendAudit(this.db, 'territory', sharedTerritory.id, 'share_skill', {
      skill_id: input.skill_id,
      share_id: shareId,
      from: input.from_village_id,
      to: input.to_village_id,
    }, actor);

    return { shared: true, message: `Skill "${skill.name}" shared from ${input.from_village_id} to ${input.to_village_id}` };
  }

  // === Law Template Sharing ===

  getSharedLawTemplates(territoryId: string): Record<string, unknown>[] {
    const territory = this.get(territoryId);
    if (!territory) return [];

    // Find active law_template agreements
    const agreements = this.listAgreements(territoryId, { status: 'active' });
    const templateAgreements = agreements.filter((a) => a.type === 'law_template');

    if (templateAgreements.length === 0) return [];

    // Collect active laws from all territory villages as templates
    const templates: Record<string, unknown>[] = [];
    for (const vid of territory.village_ids) {
      const rows = this.db.prepare("SELECT * FROM laws WHERE village_id = ? AND status = 'active'")
        .all(vid) as Record<string, unknown>[];
      for (const row of rows) {
        templates.push({
          law_id: row.id,
          village_id: vid,
          category: row.category,
          content: JSON.parse((row.content as string) || '{}'),
          risk_level: row.risk_level,
        });
      }
    }

    return templates;
  }

  private deserializeTerritory(row: Record<string, unknown>): Territory {
    return {
      id: row.id as string,
      name: row.name as string,
      village_ids: JSON.parse((row.village_ids as string) || '[]'),
      status: row.status as Territory['status'],
      version: row.version as number,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    };
  }

  private deserializeAgreement(row: Record<string, unknown>): Agreement {
    return {
      id: row.id as string,
      territory_id: row.territory_id as string,
      type: row.type as Agreement['type'],
      parties: JSON.parse((row.parties as string) || '[]'),
      terms: JSON.parse((row.terms as string) || '{}'),
      approved_by: JSON.parse((row.approved_by as string) || '{}'),
      status: row.status as Agreement['status'],
      version: row.version as number,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    };
  }
}
