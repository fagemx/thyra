import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { createDb, initSchema } from './db';
import { VillageManager } from './village-manager';
import { ConstitutionStore } from './constitution-store';
import { SkillRegistry } from './skill-registry';
import { ChiefEngine } from './chief-engine';
import { LawEngine } from './law-engine';

const LAW_INPUT = {
  category: 'review',
  content: { description: '2 approvals required', strategy: { min: 2 } },
  evidence: { source: 'init', reasoning: 'best practice' },
};

describe('LawEngine', () => {
  let db: Database;
  let lawEngine: LawEngine;
  let chiefEngine: ChiefEngine;
  let villageId: string;
  let chiefWithEnact: string;
  let chiefWithoutEnact: string;
  let chiefNoPropose: string;

  beforeEach(() => {
    db = createDb(':memory:');
    initSchema(db);
    const villageMgr = new VillageManager(db);
    villageId = villageMgr.create({ name: 'test', target_repo: 'r' }, 'u').id;

    const constitutionStore = new ConstitutionStore(db);
    constitutionStore.create(villageId, {
      rules: [{ description: 'must review', enforcement: 'hard', scope: ['*'] }],
      allowed_permissions: ['dispatch_task', 'propose_law', 'enact_law_low'],
      budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
    }, 'human');

    const skillRegistry = new SkillRegistry(db);
    chiefEngine = new ChiefEngine(db, constitutionStore, skillRegistry);
    lawEngine = new LawEngine(db, constitutionStore, chiefEngine);

    // Chief with propose_law + enact_law_low
    chiefWithEnact = chiefEngine.create(villageId, {
      name: 'Enactor',
      role: 'lawmaker',
      permissions: ['propose_law', 'enact_law_low'],
    }, 'h').id;

    // Chief with propose_law only
    chiefWithoutEnact = chiefEngine.create(villageId, {
      name: 'Proposer',
      role: 'proposer',
      permissions: ['propose_law'],
    }, 'h').id;

    // Chief without propose_law
    chiefNoPropose = chiefEngine.create(villageId, {
      name: 'Worker',
      role: 'worker',
      permissions: ['dispatch_task'],
    }, 'h').id;
  });

  it('propose: low risk + enact_law_low → auto-approved', () => {
    const law = lawEngine.propose(villageId, chiefWithEnact, LAW_INPUT);
    expect(law.status).toBe('active');
    expect(law.approved_by).toBe('auto');
    expect(law.risk_level).toBe('low');
  });

  it('propose: low risk without enact_law_low → proposed', () => {
    const law = lawEngine.propose(villageId, chiefWithoutEnact, LAW_INPUT);
    expect(law.status).toBe('proposed');
    expect(law.approved_by).toBeNull();
  });

  it('propose: high risk (deploy keyword) → proposed even with enact_law_low', () => {
    const law = lawEngine.propose(villageId, chiefWithEnact, {
      ...LAW_INPUT,
      content: { description: 'auto deploy to production', strategy: {} },
    });
    expect(law.status).toBe('proposed');
    expect(law.risk_level).toBe('high');
  });

  it('propose: medium risk (same category has active law) → proposed', () => {
    // First law auto-approved
    lawEngine.propose(villageId, chiefWithEnact, LAW_INPUT);
    // Second law in same category → medium risk
    const law2 = lawEngine.propose(villageId, chiefWithEnact, {
      ...LAW_INPUT,
      content: { description: '3 approvals', strategy: { min: 3 } },
    });
    expect(law2.status).toBe('proposed');
    expect(law2.risk_level).toBe('medium');
  });

  it('propose: chief lacks propose_law → error', () => {
    expect(() => lawEngine.propose(villageId, chiefNoPropose, LAW_INPUT))
      .toThrow('propose_law');
  });

  it('propose: no active constitution → error', () => {
    const villageMgr = new VillageManager(db);
    const v2 = villageMgr.create({ name: 'no-const', target_repo: 'r' }, 'u');
    expect(() => lawEngine.propose(v2.id, chiefWithEnact, LAW_INPUT))
      .toThrow('No active constitution');
  });

  it('approve: proposed → active', () => {
    const law = lawEngine.propose(villageId, chiefWithoutEnact, LAW_INPUT);
    const approved = lawEngine.approve(law.id, 'human');
    expect(approved.status).toBe('active');
    expect(approved.approved_by).toBe('human');
  });

  it('reject: proposed → rejected', () => {
    const law = lawEngine.propose(villageId, chiefWithoutEnact, LAW_INPUT);
    const rejected = lawEngine.reject(law.id, 'human', 'not needed');
    expect(rejected.status).toBe('rejected');
  });

  it('revoke: active → revoked', () => {
    const law = lawEngine.propose(villageId, chiefWithEnact, LAW_INPUT);
    const revoked = lawEngine.revoke(law.id, 'human');
    expect(revoked.status).toBe('revoked');
  });

  it('rollback: active → rolled_back', () => {
    const law = lawEngine.propose(villageId, chiefWithEnact, LAW_INPUT);
    const rolled = lawEngine.rollback(law.id, 'human', 'bad results');
    expect(rolled.status).toBe('rolled_back');
  });

  it('evaluate: harmful + auto-approved → auto-rollback', () => {
    const law = lawEngine.propose(villageId, chiefWithEnact, LAW_INPUT);
    expect(law.approved_by).toBe('auto');
    const evaluated = lawEngine.evaluate(law.id, { metrics: { quality: 0.3 }, verdict: 'harmful' });
    expect(evaluated.status).toBe('rolled_back');
    expect(evaluated.effectiveness?.verdict).toBe('harmful');
  });

  it('evaluate: harmful + human-approved → stays active', () => {
    const law = lawEngine.propose(villageId, chiefWithoutEnact, LAW_INPUT);
    lawEngine.approve(law.id, 'human');
    const evaluated = lawEngine.evaluate(law.id, { metrics: { quality: 0.3 }, verdict: 'harmful' });
    // Should NOT be rolled back (human approved)
    const refreshed = lawEngine.get(law.id);
    expect(refreshed?.status).toBe('active');
  });

  it('evaluate: effective → stays active with effectiveness data', () => {
    const law = lawEngine.propose(villageId, chiefWithEnact, LAW_INPUT);
    const evaluated = lawEngine.evaluate(law.id, { metrics: { quality: 0.95 }, verdict: 'effective' });
    expect(evaluated.effectiveness?.verdict).toBe('effective');
    expect(lawEngine.get(law.id)?.status).toBe('active');
  });

  it('getActiveLaws: only returns active', () => {
    lawEngine.propose(villageId, chiefWithEnact, LAW_INPUT);
    const proposed = lawEngine.propose(villageId, chiefWithoutEnact, {
      ...LAW_INPUT,
      category: 'security',
      content: { description: 'security check', strategy: {} },
    });
    expect(lawEngine.getActiveLaws(villageId)).toHaveLength(1);
  });

  it('getActiveLaws: filters by category', () => {
    lawEngine.propose(villageId, chiefWithEnact, LAW_INPUT);
    expect(lawEngine.getActiveLaws(villageId, 'review')).toHaveLength(1);
    expect(lawEngine.getActiveLaws(villageId, 'other')).toHaveLength(0);
  });

  it('list: returns all laws including history', () => {
    lawEngine.propose(villageId, chiefWithEnact, LAW_INPUT);
    lawEngine.propose(villageId, chiefWithoutEnact, {
      ...LAW_INPUT,
      category: 'testing',
      content: { description: 'require tests', strategy: {} },
    });
    expect(lawEngine.list(villageId)).toHaveLength(2);
  });

  it('get: returns law by id', () => {
    const law = lawEngine.propose(villageId, chiefWithEnact, LAW_INPUT);
    expect(lawEngine.get(law.id)?.category).toBe('review');
  });

  it('get: non-existent → null', () => {
    expect(lawEngine.get('xxx')).toBeNull();
  });

  // --- checkCompliance rule enforcement tests (Issue #22) ---

  describe('checkCompliance rule enforcement', () => {
    let complianceVillageId: string;
    let complianceChiefId: string;
    let complianceLawEngine: LawEngine;
    let complianceDb: Database;

    function setupWithRules(rules: Array<{ description: string; enforcement: 'hard' | 'soft'; scope: string[] }>) {
      complianceDb = createDb(':memory:');
      initSchema(complianceDb);
      const vm = new VillageManager(complianceDb);
      complianceVillageId = vm.create({ name: 'compliance-test', target_repo: 'r' }, 'u').id;

      const cs = new ConstitutionStore(complianceDb);
      cs.create(complianceVillageId, {
        rules,
        allowed_permissions: ['dispatch_task', 'propose_law', 'enact_law_low'],
        budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
      }, 'human');

      const sr = new SkillRegistry(complianceDb);
      const ce = new ChiefEngine(complianceDb, cs, sr);
      complianceLawEngine = new LawEngine(complianceDb, cs, ce);

      complianceChiefId = ce.create(complianceVillageId, {
        name: 'TestChief',
        role: 'lawmaker',
        permissions: ['propose_law', 'enact_law_low'],
      }, 'h').id;
    }

    it('hard rule violation → law rejected', () => {
      setupWithRules([
        { description: 'must review all PRs', enforcement: 'hard', scope: ['*'] },
      ]);
      const law = complianceLawEngine.propose(complianceVillageId, complianceChiefId, {
        category: 'workflow',
        content: { description: 'skip review for hotfixes', strategy: {} },
        evidence: { source: 'test', reasoning: 'speed' },
      });
      expect(law.status).toBe('rejected');
      expect(law.risk_level).toBe('high');
    });

    it('soft rule violation → risk bumped to medium', () => {
      setupWithRules([
        { description: 'prefer pair programming', enforcement: 'soft', scope: ['*'] },
      ]);
      const law = complianceLawEngine.propose(complianceVillageId, complianceChiefId, {
        category: 'workflow',
        content: { description: 'skip pair programming on small fixes', strategy: {} },
        evidence: { source: 'test', reasoning: 'efficiency' },
      });
      // Soft violation bumps risk from low to medium → not auto-approved
      expect(law.status).toBe('proposed');
      expect(law.risk_level).toBe('medium');
    });

    it('non-violating proposal → normal flow', () => {
      setupWithRules([
        { description: 'must review', enforcement: 'hard', scope: ['*'] },
      ]);
      const law = complianceLawEngine.propose(complianceVillageId, complianceChiefId, {
        category: 'linting',
        content: { description: 'add linting step', strategy: { tool: 'eslint' } },
        evidence: { source: 'test', reasoning: 'quality' },
      });
      // No violation, low risk → auto-approved
      expect(law.status).toBe('active');
      expect(law.approved_by).toBe('auto');
    });

    it('scope filtering: rule scoped to chief-X does not affect chief-Y', () => {
      complianceDb = createDb(':memory:');
      initSchema(complianceDb);
      const vm = new VillageManager(complianceDb);
      complianceVillageId = vm.create({ name: 'scope-test', target_repo: 'r' }, 'u').id;

      const cs = new ConstitutionStore(complianceDb);
      cs.create(complianceVillageId, {
        rules: [
          { description: 'must not auto-deploy', enforcement: 'hard', scope: ['chief-X'] },
        ],
        allowed_permissions: ['dispatch_task', 'propose_law', 'enact_law_low'],
        budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
      }, 'human');

      const sr = new SkillRegistry(complianceDb);
      const ce = new ChiefEngine(complianceDb, cs, sr);
      complianceLawEngine = new LawEngine(complianceDb, cs, ce);

      // Chief-Y (not chief-X)
      const chiefY = ce.create(complianceVillageId, {
        name: 'ChiefY',
        role: 'lawmaker',
        permissions: ['propose_law', 'enact_law_low'],
      }, 'h').id;

      const law = complianceLawEngine.propose(complianceVillageId, chiefY, {
        category: 'deploy',
        content: { description: 'auto-deploy to staging', strategy: {} },
        evidence: { source: 'test', reasoning: 'speed' },
      });
      // Rule scoped to chief-X should NOT reject chief-Y
      // (staging keyword triggers medium risk via assessRisk, not rejected by compliance)
      expect(law.status).not.toBe('rejected');
    });

    it('hard violation writes audit trail', () => {
      setupWithRules([
        { description: 'must review all changes', enforcement: 'hard', scope: ['*'] },
      ]);
      const law = complianceLawEngine.propose(complianceVillageId, complianceChiefId, {
        category: 'workflow',
        content: { description: 'skip review on docs', strategy: {} },
        evidence: { source: 'test', reasoning: 'speed' },
      });
      expect(law.status).toBe('rejected');

      // Verify audit log entry
      const audits = complianceDb.prepare(
        "SELECT * FROM audit_log WHERE entity_type = 'law' AND entity_id = ? AND action = 'rejected'"
      ).all(law.id) as Array<Record<string, unknown>>;
      expect(audits).toHaveLength(1);
      const payload = JSON.parse(audits[0].payload as string);
      expect(payload.violations).toBeDefined();
      expect(payload.violations.length).toBeGreaterThan(0);
    });

    it('multiple rules — one hard violation is enough to reject', () => {
      setupWithRules([
        { description: 'prefer documentation', enforcement: 'soft', scope: ['*'] },
        { description: 'must review all PRs', enforcement: 'hard', scope: ['*'] },
        { description: 'prefer pair programming', enforcement: 'soft', scope: ['*'] },
      ]);
      const law = complianceLawEngine.propose(complianceVillageId, complianceChiefId, {
        category: 'workflow',
        content: { description: 'skip review for trivial changes', strategy: {} },
        evidence: { source: 'test', reasoning: 'speed' },
      });
      expect(law.status).toBe('rejected');
      expect(law.risk_level).toBe('high');
    });

    it('negative rule: "must not X" blocks law that enables X', () => {
      setupWithRules([
        { description: 'must not auto-deploy', enforcement: 'hard', scope: ['*'] },
      ]);
      const law = complianceLawEngine.propose(complianceVillageId, complianceChiefId, {
        category: 'ci',
        content: { description: 'enable auto-deploy for main branch', strategy: {} },
        evidence: { source: 'test', reasoning: 'convenience' },
      });
      expect(law.status).toBe('rejected');
    });
  });
});
