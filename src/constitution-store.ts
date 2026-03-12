import type { Database } from 'bun:sqlite';
import { randomUUID } from 'crypto';
import { appendAudit } from './db';
import { CreateConstitutionInput as CreateConstitutionSchema } from './schemas/constitution';
import type { CreateConstitutionInputRaw, Permission } from './schemas/constitution';

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
  constructor(private db: Database) {}

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

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'be', 'to', 'of', 'in', 'for',
  'and', 'or', 'it', 'this', 'that', 'all', 'on', 'with', 'as', 'by',
]);

const NEGATION_WORDS = [
  'no', 'skip', 'without', 'disable', 'never', 'remove', 'not', "don't", 'dont',
];

/** 從文字中提取有意義的關鍵字 */
function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s,.;:!?()[\]{}"']+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

/** 檢查目標文字是否違反規則描述 — Phase 0 keyword/negation matching */
export function detectRuleViolation(ruleDescription: string, targetText: string): boolean {
  const ruleKeywords = extractKeywords(ruleDescription);
  const lowerTarget = targetText.toLowerCase();
  const ruleText = ruleDescription.toLowerCase();

  // 情境 A: 規則是正面要求 (e.g. "must review")，目標文字否定了關鍵字
  for (const keyword of ruleKeywords) {
    if (NEGATION_WORDS.includes(keyword)) continue; // 跳過否定詞本身
    for (const neg of NEGATION_WORDS) {
      if (lowerTarget.includes(`${neg} ${keyword}`) || lowerTarget.includes(`${neg}_${keyword}`)) {
        return true;
      }
    }
  }

  // 情境 B: 規則是否定要求 (e.g. "must not auto-deploy")，目標文字啟用了被禁止的行為
  const hasNegationInRule = NEGATION_WORDS.some((neg) => ruleText.includes(neg));
  if (hasNegationInRule) {
    // 找出規則中否定詞後面的關鍵字
    const contentKeywords = ruleKeywords.filter((kw) => !NEGATION_WORDS.includes(kw));
    const targetKeywords = extractKeywords(targetText);
    // 目標文字含有被禁止的關鍵字，且目標文字沒有否定它
    for (const keyword of contentKeywords) {
      if (!targetKeywords.includes(keyword)) continue;
      // 確認目標文字中該關鍵字沒有被否定
      const isNegatedInTarget = NEGATION_WORDS.some(
        (neg) => lowerTarget.includes(`${neg} ${keyword}`) || lowerTarget.includes(`${neg}_${keyword}`),
      );
      if (!isNegatedInTarget) {
        return true;
      }
    }
  }

  return false;
}

/** Check constitution rules for a given chief (framework for T4/T5) */
export function checkRules(
  constitution: Constitution,
  chiefId: string,
  targetText?: string,
): { allowed: boolean; violated: ConstitutionRule[] } {
  const violated: ConstitutionRule[] = [];
  for (const rule of constitution.rules) {
    const inScope = rule.scope.includes('*') || rule.scope.includes(chiefId);
    if (!inScope) continue;
    if (targetText && detectRuleViolation(rule.description, targetText)) {
      violated.push(rule);
    }
  }
  return { allowed: violated.length === 0, violated };
}
