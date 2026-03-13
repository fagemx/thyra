import type { Database } from 'bun:sqlite';
import { randomUUID } from 'crypto';
import { appendAudit } from './db';
import { detectRuleViolation } from './constitution-store';
import type { ConstitutionStore, Constitution, ConstitutionRule } from './constitution-store';
import type { ChiefEngine } from './chief-engine';
import { ProposeLawInput as ProposeLawSchema, EvaluateLawInput as EvaluateLawSchema } from './schemas/law';
import type { ProposeLawInputRaw, ProposeLawInput, EvaluateLawInput } from './schemas/law';
import type { EddaBridge } from './edda-bridge';

export interface Law {
  id: string;
  village_id: string;
  proposed_by: string;
  approved_by: string | null;
  version: number;
  status: 'proposed' | 'active' | 'revoked' | 'rolled_back' | 'rejected';
  category: string;
  content: { description: string; strategy: Record<string, unknown> };
  risk_level: 'low' | 'medium' | 'high';
  evidence: { source: string; reasoning: string; edda_refs?: string[] };
  effectiveness: { measured_at: string; metrics: Record<string, number>; verdict: string } | null;
  created_at: string;
  updated_at: string;
}

export class LawEngine {
  constructor(
    private db: Database,
    private constitutionStore: ConstitutionStore,
    private chiefEngine: ChiefEngine,
    private eddaBridge?: EddaBridge,
  ) {}

  /** Fire-and-forget: record law lifecycle event to Edda ledger */
  private recordToEdda(lawId: string, aspect: string, value: string, reason: string): void {
    if (!this.eddaBridge) return;
    void this.eddaBridge.recordDecision({
      domain: 'law',
      aspect: `${lawId}.${aspect}`,
      value,
      reason,
    }).catch(() => {}); // 不 throw — Edda 離線不影響 LawEngine
  }

  propose(villageId: string, chiefId: string, rawInput: ProposeLawInputRaw): Law {
    const input = ProposeLawSchema.parse(rawInput);

    // 1. Active constitution
    const constitution = this.constitutionStore.getActive(villageId);
    if (!constitution) throw new Error('No active constitution');

    // 2. Chief has propose_law permission
    const chief = this.chiefEngine.get(chiefId);
    if (!chief) throw new Error('Chief not found');
    if (!chief.permissions.includes('propose_law')) {
      throw new Error('Chief lacks propose_law permission');
    }

    // 3. Constitution compliance check (THY-02)
    const compliance = this.checkCompliance(constitution, input);
    if (compliance.hardViolations.length > 0) {
      const law = this.insertLaw(villageId, chiefId, input, 'rejected', 'high');
      appendAudit(this.db, 'law', law.id, 'rejected', { violations: compliance.hardViolations.map((r) => r.description) }, chiefId);
      this.recordToEdda(law.id, 'status', 'rejected', `hard violation: ${compliance.hardViolations.map((r) => r.description).join(', ')}`);
      return law;
    }

    // 4. Risk level
    let risk = this.assessRisk(input, constitution);
    if (compliance.softViolations.length > 0 && risk === 'low') {
      risk = 'medium';
    }

    // 5. Low risk + enact_law_low → auto-approve (THY-03)
    if (risk === 'low' && chief.permissions.includes('enact_law_low')) {
      const law = this.insertLaw(villageId, chiefId, input, 'active', 'low');
      this.db.prepare('UPDATE laws SET approved_by = ? WHERE id = ?').run('auto', law.id);
      appendAudit(this.db, 'law', law.id, 'auto_approved', { risk }, chiefId);
      this.recordToEdda(law.id, 'status', 'auto_approved', `category=${input.category}, risk=low, auto-enacted`);
      return { ...law, status: 'active', approved_by: 'auto' };
    }

    // 6. Otherwise → proposed
    const law = this.insertLaw(villageId, chiefId, input, 'proposed', risk);
    appendAudit(this.db, 'law', law.id, 'proposed', { risk, soft_violations: compliance.softViolations.map((r) => r.description) }, chiefId);
    this.recordToEdda(law.id, 'status', 'proposed', `category=${input.category}, risk=${risk}`);
    return law;
  }

  approve(id: string, actor: string): Law {
    const law = this.get(id);
    if (!law || law.status !== 'proposed') throw new Error('Law not found or not proposed');
    const now = new Date().toISOString();
    this.db.prepare('UPDATE laws SET status = ?, approved_by = ?, updated_at = ? WHERE id = ?')
      .run('active', actor, now, id);
    appendAudit(this.db, 'law', id, 'approved', {}, actor);
    this.recordToEdda(id, 'status', 'approved', `approved by ${actor}`);
    return { ...law, status: 'active', approved_by: actor, updated_at: now };
  }

  reject(id: string, actor: string, reason?: string): Law {
    const law = this.get(id);
    if (!law || law.status !== 'proposed') throw new Error('Law not found or not proposed');
    const now = new Date().toISOString();
    this.db.prepare('UPDATE laws SET status = ?, updated_at = ? WHERE id = ?')
      .run('rejected', now, id);
    appendAudit(this.db, 'law', id, 'rejected', { reason }, actor);
    this.recordToEdda(id, 'status', 'rejected', `rejected by ${actor}: ${reason ?? 'no reason'}`);
    return { ...law, status: 'rejected', updated_at: now };
  }

  revoke(id: string, actor: string): Law {
    const law = this.get(id);
    if (!law || law.status !== 'active') throw new Error('Law not found or not active');
    const now = new Date().toISOString();
    this.db.prepare('UPDATE laws SET status = ?, updated_at = ? WHERE id = ?')
      .run('revoked', now, id);
    appendAudit(this.db, 'law', id, 'revoked', {}, actor);
    this.recordToEdda(id, 'status', 'revoked', `revoked by ${actor}`);
    return { ...law, status: 'revoked', updated_at: now };
  }

  rollback(id: string, actor: string, reason: string): Law {
    const law = this.get(id);
    if (!law || law.status !== 'active') throw new Error('Law not found or not active');
    const now = new Date().toISOString();
    this.db.prepare('UPDATE laws SET status = ?, updated_at = ? WHERE id = ?')
      .run('rolled_back', now, id);
    appendAudit(this.db, 'law', id, 'rolled_back', { reason }, actor);
    this.recordToEdda(id, 'status', 'rolled_back', reason);
    return { ...law, status: 'rolled_back', updated_at: now };
  }

  evaluate(id: string, rawInput: EvaluateLawInput): Law {
    const input = EvaluateLawSchema.parse(rawInput);
    const law = this.get(id);
    if (!law || law.status !== 'active') throw new Error('Law not found or not active');

    const effectiveness = {
      measured_at: new Date().toISOString(),
      metrics: input.metrics,
      verdict: input.verdict,
    };

    const now = new Date().toISOString();
    this.db.prepare('UPDATE laws SET effectiveness = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(effectiveness), now, id);

    // Harmful + auto-approved → auto-rollback (THY-03 safety net)
    if (input.verdict === 'harmful' && law.approved_by === 'auto') {
      this.recordToEdda(id, 'safety', 'auto_rollback', 'harmful verdict on auto-approved law — triggering safety rollback');
      this.rollback(id, 'system', 'Auto-rollback: harmful verdict on auto-approved law');
      return { ...law, effectiveness, status: 'rolled_back', updated_at: now };
    }

    appendAudit(this.db, 'law', id, 'evaluated', effectiveness, 'system');
    this.recordToEdda(id, 'effectiveness', input.verdict, `metrics: ${JSON.stringify(input.metrics)}`);
    return { ...law, effectiveness, updated_at: now };
  }

  get(id: string): Law | null {
    const row = this.db.prepare('SELECT * FROM laws WHERE id = ?').get(id) as Record<string, unknown> | null;
    return row ? this.deserialize(row) : null;
  }

  getActiveLaws(villageId: string, category?: string): Law[] {
    let sql = 'SELECT * FROM laws WHERE village_id = ? AND status = ?';
    const params: string[] = [villageId, 'active'];
    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.deserialize(r));
  }

  list(villageId: string): Law[] {
    const rows = this.db.prepare('SELECT * FROM laws WHERE village_id = ? ORDER BY created_at DESC')
      .all(villageId) as Record<string, unknown>[];
    return rows.map((r) => this.deserialize(r));
  }

  private checkCompliance(constitution: Constitution, input: ProposeLawInput) {
    const hardViolations: ConstitutionRule[] = [];
    const softViolations: ConstitutionRule[] = [];
    // Phase 0: keyword matching against constitution rules
    const lawText = input.content.description + ' ' + JSON.stringify(input.content.strategy);
    for (const rule of constitution.rules) {
      if (detectRuleViolation(rule.description, lawText)) {
        if (rule.enforcement === 'hard') {
          hardViolations.push(rule);
        } else {
          softViolations.push(rule);
        }
      }
    }
    return { hardViolations, softViolations };
  }

  private assessRisk(input: ProposeLawInput, constitution: Constitution): 'low' | 'medium' | 'high' {
    const desc = input.content.description.toLowerCase();
    if (desc.includes('deploy') || desc.includes('merge') || desc.includes('production')) return 'high';
    if (desc.includes('branch') || desc.includes('staging')) return 'medium';
    // Same category already has active law → medium
    const existing = this.getActiveLaws(constitution.village_id, input.category);
    if (existing.length > 0) return 'medium';
    return 'low';
  }

  private insertLaw(villageId: string, chiefId: string, input: ProposeLawInput, status: Law['status'], risk: Law['risk_level']): Law {
    const now = new Date().toISOString();
    const law: Law = {
      id: `law-${randomUUID()}`,
      village_id: villageId,
      proposed_by: chiefId,
      approved_by: null,
      version: 1,
      status,
      category: input.category,
      content: input.content,
      risk_level: risk,
      evidence: input.evidence,
      effectiveness: null,
      created_at: now,
      updated_at: now,
    };
    this.db.prepare(`
      INSERT INTO laws (id, village_id, proposed_by, version, status, category, content, risk_level, evidence, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(law.id, villageId, chiefId, 1, status, input.category,
      JSON.stringify(input.content), risk, JSON.stringify(input.evidence), now, now);
    return law;
  }

  private deserialize(row: Record<string, unknown>): Law {
    return {
      id: row.id as string,
      village_id: row.village_id as string,
      proposed_by: row.proposed_by as string,
      approved_by: (row.approved_by as string) || null,
      version: row.version as number,
      status: row.status as Law['status'],
      category: row.category as string,
      content: JSON.parse((row.content as string) || '{}'),
      risk_level: row.risk_level as Law['risk_level'],
      evidence: JSON.parse((row.evidence as string) || '{}'),
      effectiveness: row.effectiveness ? JSON.parse(row.effectiveness as string) : null,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    };
  }
}
