import type { Database } from 'bun:sqlite';
import { randomUUID } from 'crypto';
import { appendAudit } from './db';
import { CreateConstitutionInput as CreateConstitutionSchema } from './schemas/constitution';
import type { CreateConstitutionInputRaw, Permission } from './schemas/constitution';
import type { KarviBridge } from './karvi-bridge';

export interface ConstitutionRule {
  id: string;
  description: string;
  enforcement: 'hard' | 'soft';
  scope: string[];
}

export interface BudgetLimits {
  max_cost_per_action: number;
  max_cost_per_day: number;
  max_cost_per_loop: number;
}

export interface Constitution {
  id: string;
  village_id: string;
  version: number;
  status: 'active' | 'revoked' | 'superseded';
  created_at: string;
  created_by: string;
  rules: ConstitutionRule[];
  allowed_permissions: Permission[];
  budget_limits: BudgetLimits;
  superseded_by: string | null;
}

export class ConstitutionStore {
  constructor(
    private db: Database,
    private karviBridge?: KarviBridge,
  ) {}

  /** Fire-and-forget: sync budget to Karvi controls */
  private syncToKarvi(villageId: string, budgetLimits: BudgetLimits): void {
    if (!this.karviBridge) return;
    void this.karviBridge.syncBudgetControls(villageId, budgetLimits).catch(() => {});
  }

  create(villageId: string, rawInput: CreateConstitutionInputRaw, actor: string): Constitution {
    const input = CreateConstitutionSchema.parse(rawInput);
    const existing = this.getActive(villageId);
    if (existing) {
      throw new Error('Village already has an active constitution. Use supersede() instead.');
    }

    const now = new Date().toISOString();
    const constitution: Constitution = {
      id: `const-${randomUUID()}`,
      village_id: villageId,
      version: 1,
      status: 'active',
      created_at: now,
      created_by: actor,
      rules: input.rules.map((r, i) => ({ ...r, id: r.id ?? `rule-${i + 1}` })),
      allowed_permissions: input.allowed_permissions,
      budget_limits: input.budget_limits,
      superseded_by: null,
    };

    this.db.prepare(`
      INSERT INTO constitutions
        (id, village_id, version, status, created_at, created_by, rules, allowed_permissions, budget_limits)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      constitution.id, villageId, constitution.version, constitution.status,
      now, actor,
      JSON.stringify(constitution.rules),
      JSON.stringify(constitution.allowed_permissions),
      JSON.stringify(constitution.budget_limits),
    );

    appendAudit(this.db, 'constitution', constitution.id, 'create', constitution, actor);
    this.syncToKarvi(villageId, constitution.budget_limits);
    return constitution;
  }

  get(id: string): Constitution | null {
    const row = this.db.prepare('SELECT * FROM constitutions WHERE id = ?').get(id) as Record<string, unknown> | null;
    return row ? this.deserialize(row) : null;
  }

  getActive(villageId: string): Constitution | null {
    const row = this.db.prepare(
      'SELECT * FROM constitutions WHERE village_id = ? AND status = ? ORDER BY version DESC LIMIT 1'
    ).get(villageId, 'active') as Record<string, unknown> | null;
    return row ? this.deserialize(row) : null;
  }

  list(villageId: string): Constitution[] {
    const rows = this.db.prepare(
      'SELECT * FROM constitutions WHERE village_id = ? ORDER BY version DESC'
    ).all(villageId) as Record<string, unknown>[];
    return rows.map((r) => this.deserialize(r));
  }

  revoke(id: string, actor: string): void {
    const c = this.get(id);
    if (!c || c.status !== 'active') throw new Error('Constitution not found or not active');
    this.db.prepare('UPDATE constitutions SET status = ? WHERE id = ?').run('revoked', id);
    appendAudit(this.db, 'constitution', id, 'revoke', { previous_status: c.status }, actor);
  }

  supersede(id: string, rawInput: CreateConstitutionInputRaw, actor: string): Constitution {
    const input = CreateConstitutionSchema.parse(rawInput);
    const old = this.get(id);
    if (!old || old.status !== 'active') throw new Error('Constitution not found or not active');

    const now = new Date().toISOString();
    const newConstitution: Constitution = {
      id: `const-${randomUUID()}`,
      village_id: old.village_id,
      version: old.version + 1,
      status: 'active',
      created_at: now,
      created_by: actor,
      rules: input.rules.map((r, i) => ({ ...r, id: r.id ?? `rule-${i + 1}` })),
      allowed_permissions: input.allowed_permissions,
      budget_limits: input.budget_limits,
      superseded_by: null,
    };

    this.db.transaction(() => {
      this.db.prepare(
        'UPDATE constitutions SET status = ?, superseded_by = ? WHERE id = ?'
      ).run('superseded', newConstitution.id, id);

      this.db.prepare(`
        INSERT INTO constitutions
          (id, village_id, version, status, created_at, created_by, rules, allowed_permissions, budget_limits)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        newConstitution.id, newConstitution.village_id, newConstitution.version,
        newConstitution.status, now, actor,
        JSON.stringify(newConstitution.rules),
        JSON.stringify(newConstitution.allowed_permissions),
        JSON.stringify(newConstitution.budget_limits),
      );
    })();

    appendAudit(this.db, 'constitution', id, 'supersede', { old_id: id, new_id: newConstitution.id, new_version: newConstitution.version }, actor);
    this.syncToKarvi(newConstitution.village_id, newConstitution.budget_limits);
    return newConstitution;
  }

  private deserialize(row: Record<string, unknown>): Constitution {
    return {
      id: row.id as string,
      village_id: row.village_id as string,
      version: row.version as number,
      status: row.status as Constitution['status'],
      created_at: row.created_at as string,
      created_by: row.created_by as string,
      rules: JSON.parse((row.rules as string) || '[]'),
      allowed_permissions: JSON.parse((row.allowed_permissions as string) || '[]'),
      budget_limits: JSON.parse((row.budget_limits as string) || '{}'),
      superseded_by: (row.superseded_by as string) || null,
    };
  }
}

/** Check if a permission is allowed by the constitution */
export function checkPermission(constitution: Constitution, permission: Permission): boolean {
  return constitution.allowed_permissions.includes(permission);
}

/** Check if a budget amount is within limits */
export function checkBudget(
  constitution: Constitution,
  amount: number,
  type: 'per_action' | 'per_day' | 'per_loop',
): boolean {
  const key = { per_action: 'max_cost_per_action', per_day: 'max_cost_per_day', per_loop: 'max_cost_per_loop' }[type] as keyof BudgetLimits;
  return amount <= constitution.budget_limits[key];
}

/** Check constitution rules for a given chief (framework for T4/T5) */
export function checkRules(
  constitution: Constitution,
  chiefId: string,
): { allowed: boolean; violated: ConstitutionRule[] } {
  const violated: ConstitutionRule[] = [];
  for (const rule of constitution.rules) {
    const inScope = rule.scope.includes('*') || rule.scope.includes(chiefId);
    if (!inScope) continue;
    // Match logic placeholder — actual matching implemented in T4 Law Engine
  }
  return { allowed: violated.length === 0, violated };
}
