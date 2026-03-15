import type { Database } from 'bun:sqlite';
import { randomUUID } from 'crypto';
import { appendAudit } from './db';
import type { ConstitutionStore } from './constitution-store';
import type { SkillRegistry } from './skill-registry';
import {
  CreateTerritoryInput as CreateTerritorySchema,
  CreateAgreementInput as CreateAgreementSchema,
  ShareSkillInput as ShareSkillSchema,
  CreateTerritoryPolicyInput as CreateTerritoryPolicySchema,
  AddVillageInput as AddVillageSchema,
} from './schemas/territory';
import type {
  CreateTerritoryInputRaw,
  CreateAgreementInputRaw,
  ShareSkillInputRaw,
  CreateTerritoryPolicyInputRaw,
  AddVillageInputRaw,
  TerritoryAuditQueryInput,
} from './schemas/territory';

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

export interface TerritoryPolicy {
  id: string;
  territory_id: string;
  name: string;
  description: string;
  enforcement: 'hard' | 'soft';
  scope: string[];
  status: 'active' | 'revoked';
  version: number;
  created_at: string;
  updated_at: string;
}

/** 跨 Village 聚合指標 */
export interface TerritoryCycleMetrics {
  territory_id: string;
  village_count: number;
  total_cycles: number;
  total_actions_executed: number;
  total_actions_blocked: number;
  total_laws_proposed: number;
  total_laws_enacted: number;
  total_cost_incurred: number;
  per_village: Array<{
    village_id: string;
    cycles: number;
    cost_incurred: number;
  }>;
}

/** 跨 Village 可引用的 precedent */
export interface SharedPrecedent {
  law_id: string;
  village_id: string;
  category: string;
  description: string;
  risk_level: string;
  effectiveness_verdict: string | null;
  created_at: string;
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

      // Revoke all active policies
      this.db.prepare("UPDATE territory_policies SET status = 'revoked', updated_at = ? WHERE territory_id = ? AND status = 'active'")
        .run(now, id);

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

  // === Territory Policy ===

  createPolicy(territoryId: string, rawInput: CreateTerritoryPolicyInputRaw, actor: string): TerritoryPolicy {
    const input = CreateTerritoryPolicySchema.parse(rawInput);

    const territory = this.get(territoryId);
    if (!territory || territory.status !== 'active') throw new Error('Territory not found or not active');

    // SI-7: 所有 member village 的 constitution 必須允許 cross_village
    for (const vid of territory.village_ids) {
      const constitution = this.constitutionStore.getActive(vid);
      if (!constitution) {
        throw new Error(`Village ${vid} has no active constitution`);
      }
      if (!constitution.allowed_permissions.includes('cross_village')) {
        throw new Error(`CONSTITUTION_FORBIDS_CROSS_VILLAGE: Village ${vid} constitution does not allow cross_village`);
      }
    }

    const now = new Date().toISOString();
    const policy: TerritoryPolicy = {
      id: `territory-policy-${randomUUID()}`,
      territory_id: territoryId,
      name: input.name,
      description: input.description,
      enforcement: input.enforcement,
      scope: input.scope,
      status: 'active',
      version: 1,
      created_at: now,
      updated_at: now,
    };

    this.db.prepare(`
      INSERT INTO territory_policies (id, territory_id, name, description, enforcement, scope, status, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(policy.id, territoryId, policy.name, policy.description, policy.enforcement,
      JSON.stringify(policy.scope), policy.status, policy.version, now, now);

    appendAudit(this.db, 'territory_policy', policy.id, 'create', {
      territory_id: territoryId,
      name: input.name,
      enforcement: input.enforcement,
    }, actor);

    return policy;
  }

  listPolicies(territoryId: string, opts?: { status?: string }): TerritoryPolicy[] {
    let sql = 'SELECT * FROM territory_policies WHERE territory_id = ?';
    const params: string[] = [territoryId];
    if (opts?.status) {
      sql += ' AND status = ?';
      params.push(opts.status);
    }
    sql += ' ORDER BY created_at DESC';
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.deserializePolicy(r));
  }

  revokePolicy(policyId: string, actor: string): TerritoryPolicy {
    const policy = this.getPolicy(policyId);
    if (!policy || policy.status !== 'active') throw new Error('Policy not found or not active');

    const now = new Date().toISOString();
    this.db.prepare('UPDATE territory_policies SET status = ?, updated_at = ? WHERE id = ?')
      .run('revoked', now, policyId);

    appendAudit(this.db, 'territory_policy', policyId, 'revoke', {}, actor);
    return { ...policy, status: 'revoked', updated_at: now };
  }

  getPolicy(id: string): TerritoryPolicy | null {
    const row = this.db.prepare('SELECT * FROM territory_policies WHERE id = ?').get(id) as Record<string, unknown> | null;
    return row ? this.deserializePolicy(row) : null;
  }

  /**
   * 檢查一個 village 的動作是否被 territory policy 約束
   * 如果有任何 hard enforcement policy 適用，回傳該 policy
   */
  checkTerritoryPolicies(villageId: string): TerritoryPolicy[] {
    // 找出 village 所屬的所有 active territory
    const territories = this.list({ status: 'active' });
    const memberTerritories = territories.filter((t) => t.village_ids.includes(villageId));

    const applicablePolicies: TerritoryPolicy[] = [];
    for (const t of memberTerritories) {
      const policies = this.listPolicies(t.id, { status: 'active' });
      for (const p of policies) {
        // scope ['*'] 代表所有 village，否則需包含此 village
        if (p.scope.includes('*') || p.scope.includes(villageId)) {
          applicablePolicies.push(p);
        }
      }
    }
    return applicablePolicies;
  }

  // === Add/Remove Village ===

  addVillage(territoryId: string, rawInput: AddVillageInputRaw, actor: string): Territory {
    const input = AddVillageSchema.parse(rawInput);
    const territory = this.get(territoryId);
    if (!territory || territory.status !== 'active') throw new Error('Territory not found or not active');

    if (territory.village_ids.includes(input.village_id)) {
      throw new Error('Village is already a member of this territory');
    }

    // SI-7: new village constitution must allow cross_village
    const constitution = this.constitutionStore.getActive(input.village_id);
    if (!constitution) {
      throw new Error(`Village ${input.village_id} has no active constitution`);
    }
    if (!constitution.allowed_permissions.includes('cross_village')) {
      throw new Error(`CONSTITUTION_FORBIDS_CROSS_VILLAGE: Village ${input.village_id} constitution does not allow cross_village`);
    }

    const newVillageIds = [...territory.village_ids, input.village_id];
    const now = new Date().toISOString();

    this.db.prepare('UPDATE territories SET village_ids = ?, version = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(newVillageIds), territory.version + 1, now, territoryId);

    appendAudit(this.db, 'territory', territoryId, 'add_village', { village_id: input.village_id }, actor);

    return { ...territory, village_ids: newVillageIds, version: territory.version + 1, updated_at: now };
  }

  removeVillage(territoryId: string, villageId: string, actor: string): Territory {
    const territory = this.get(territoryId);
    if (!territory || territory.status !== 'active') throw new Error('Territory not found or not active');

    if (!territory.village_ids.includes(villageId)) {
      throw new Error('Village is not a member of this territory');
    }

    // Territory needs at least 2 villages
    if (territory.village_ids.length <= 2) {
      throw new Error('Territory must have at least 2 villages; dissolve the territory instead');
    }

    const newVillageIds = territory.village_ids.filter((v) => v !== villageId);
    const now = new Date().toISOString();

    this.db.transaction(() => {
      this.db.prepare('UPDATE territories SET village_ids = ?, version = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(newVillageIds), territory.version + 1, now, territoryId);

      // Revoke skill shares involving this village
      this.db.prepare(
        "UPDATE skill_shares SET status = 'revoked' WHERE territory_id = ? AND (from_village_id = ? OR to_village_id = ?) AND status = 'active'"
      ).run(territoryId, villageId, villageId);

      appendAudit(this.db, 'territory', territoryId, 'remove_village', { village_id: villageId }, actor);
    })();

    return { ...territory, village_ids: newVillageIds, version: territory.version + 1, updated_at: now };
  }

  // === Cross-Village Metrics ===

  getCrossVillageMetrics(territoryId: string): TerritoryCycleMetrics {
    const territory = this.get(territoryId);
    if (!territory) throw new Error('Territory not found');

    const perVillage: TerritoryCycleMetrics['per_village'] = [];
    let totalCycles = 0;
    let totalActionsExecuted = 0;
    let totalActionsBlocked = 0;
    let totalLawsProposed = 0;
    let totalLawsEnacted = 0;
    let totalCostIncurred = 0;

    for (const vid of territory.village_ids) {
      const cycles = this.db.prepare(
        'SELECT * FROM loop_cycles WHERE village_id = ?'
      ).all(vid) as Record<string, unknown>[];

      let villageCost = 0;
      for (const c of cycles) {
        const actions = JSON.parse((c.actions as string) || '[]') as Array<{ status?: string }>;
        totalActionsExecuted += actions.filter((a) => a.status === 'executed').length;
        totalActionsBlocked += actions.filter((a) => a.status === 'blocked').length;
        const proposed = JSON.parse((c.laws_proposed as string) || '[]') as string[];
        const enacted = JSON.parse((c.laws_enacted as string) || '[]') as string[];
        totalLawsProposed += proposed.length;
        totalLawsEnacted += enacted.length;
        const cost = c.cost_incurred as number;
        totalCostIncurred += cost;
        villageCost += cost;
      }

      perVillage.push({
        village_id: vid,
        cycles: cycles.length,
        cost_incurred: villageCost,
      });
      totalCycles += cycles.length;
    }

    return {
      territory_id: territoryId,
      village_count: territory.village_ids.length,
      total_cycles: totalCycles,
      total_actions_executed: totalActionsExecuted,
      total_actions_blocked: totalActionsBlocked,
      total_laws_proposed: totalLawsProposed,
      total_laws_enacted: totalLawsEnacted,
      total_cost_incurred: totalCostIncurred,
      per_village: perVillage,
    };
  }

  // === Cross-Village Audit Query ===

  queryTerritoryAudit(territoryId: string, params: TerritoryAuditQueryInput): {
    events: Array<{
      id: number;
      entity_type: string;
      entity_id: string;
      action: string;
      payload: unknown;
      actor: string;
      created_at: string;
      village_id: string | null;
    }>;
    total: number;
  } {
    const territory = this.get(territoryId);
    if (!territory) throw new Error('Territory not found');

    const villageIds = territory.village_ids;
    const placeholders = villageIds.map(() => '?').join(',');

    const conditions: string[] = [];
    const values: (string | number)[] = [];

    // 搜尋 territory 自身 + 所有 member village 相關的 audit 事件
    conditions.push(`(
      (entity_type = 'territory' AND entity_id = ?)
      OR (entity_type = 'territory_policy' AND entity_id IN (SELECT id FROM territory_policies WHERE territory_id = ?))
      OR (entity_type = 'agreement' AND entity_id IN (SELECT id FROM agreements WHERE territory_id = ?))
      OR (entity_type = 'village' AND entity_id IN (${placeholders}))
      OR (entity_type = 'constitution' AND entity_id IN (SELECT id FROM constitutions WHERE village_id IN (${placeholders})))
      OR (entity_type = 'law' AND entity_id IN (SELECT id FROM laws WHERE village_id IN (${placeholders})))
      OR (entity_type = 'loop' AND entity_id IN (SELECT id FROM loop_cycles WHERE village_id IN (${placeholders})))
    )`);
    values.push(territoryId, territoryId, territoryId, ...villageIds, ...villageIds, ...villageIds, ...villageIds);

    if (params.action) {
      conditions.push('action = ?');
      values.push(params.action);
    }
    if (params.actor) {
      conditions.push('actor = ?');
      values.push(params.actor);
    }
    if (params.from) {
      conditions.push('created_at >= ?');
      values.push(params.from);
    }
    if (params.to) {
      conditions.push('created_at <= ?');
      values.push(params.to);
    }

    const whereClause = 'WHERE ' + conditions.join(' AND ');

    const countRow = this.db.prepare(
      `SELECT COUNT(*) as cnt FROM audit_log ${whereClause}`
    ).get(...values) as { cnt: number };

    const rows = this.db.prepare(
      `SELECT * FROM audit_log ${whereClause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`
    ).all(...values, params.limit, params.offset) as Array<{
      id: number;
      entity_type: string;
      entity_id: string;
      action: string;
      payload: string;
      actor: string;
      created_at: string;
    }>;

    return {
      events: rows.map((r) => ({
        id: r.id,
        entity_type: r.entity_type,
        entity_id: r.entity_id,
        action: r.action,
        payload: JSON.parse(r.payload) as unknown,
        actor: r.actor,
        created_at: r.created_at,
        village_id: this.resolveVillageId(r.entity_type, r.entity_id, villageIds),
      })),
      total: countRow.cnt,
    };
  }

  // === Shared Precedent Pool ===

  getSharedPrecedents(territoryId: string, opts?: { category?: string }): SharedPrecedent[] {
    const territory = this.get(territoryId);
    if (!territory) return [];

    // 必須有 active law_template 或 resource_sharing agreement
    const agreements = this.listAgreements(territoryId, { status: 'active' });
    if (agreements.length === 0) return [];

    const precedents: SharedPrecedent[] = [];
    for (const vid of territory.village_ids) {
      let sql = "SELECT * FROM laws WHERE village_id = ? AND status IN ('active', 'revoked', 'rolled_back')";
      const params: string[] = [vid];
      if (opts?.category) {
        sql += ' AND category = ?';
        params.push(opts.category);
      }
      sql += ' ORDER BY created_at DESC';

      const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
      for (const row of rows) {
        const content = JSON.parse((row.content as string) || '{}') as { description?: string };
        const effectiveness = row.effectiveness
          ? JSON.parse(row.effectiveness as string) as { verdict?: string }
          : null;

        precedents.push({
          law_id: row.id as string,
          village_id: vid,
          category: row.category as string,
          description: content.description ?? '',
          risk_level: row.risk_level as string,
          effectiveness_verdict: effectiveness?.verdict ?? null,
          created_at: row.created_at as string,
        });
      }
    }

    return precedents;
  }

  /** 內部：從 entity_type + entity_id 反查 village_id */
  private resolveVillageId(entityType: string, entityId: string, villageIds: string[]): string | null {
    if (entityType === 'village' && villageIds.includes(entityId)) return entityId;
    if (entityType === 'territory' || entityType === 'territory_policy' || entityType === 'agreement') return null;

    const tableMap: Record<string, string> = {
      constitution: 'constitutions',
      law: 'laws',
      chief: 'chiefs',
      skill: 'skills',
      loop: 'loop_cycles',
    };
    const table = tableMap[entityType];
    if (!table) return null;

    const row = this.db.prepare(`SELECT village_id FROM ${table} WHERE id = ?`).get(entityId) as { village_id: string } | null;
    return row?.village_id ?? null;
  }

  private deserializeTerritory(row: Record<string, unknown>): Territory {
    return {
      id: row.id as string,
      name: row.name as string,
      village_ids: JSON.parse((row.village_ids as string) || '[]') as string[],
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
      parties: JSON.parse((row.parties as string) || '[]') as Agreement['parties'],
      terms: JSON.parse((row.terms as string) || '{}') as Agreement['terms'],
      approved_by: JSON.parse((row.approved_by as string) || '{}') as Agreement['approved_by'],
      status: row.status as Agreement['status'],
      version: row.version as number,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    };
  }

  private deserializePolicy(row: Record<string, unknown>): TerritoryPolicy {
    return {
      id: row.id as string,
      territory_id: row.territory_id as string,
      name: row.name as string,
      description: row.description as string,
      enforcement: row.enforcement as TerritoryPolicy['enforcement'],
      scope: JSON.parse((row.scope as string) || '["*"]') as string[],
      status: row.status as TerritoryPolicy['status'],
      version: row.version as number,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    };
  }
}
