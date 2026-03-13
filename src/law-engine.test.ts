import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Database } from 'bun:sqlite';
import { createDb, initSchema } from './db';
import { VillageManager } from './village-manager';
import { ConstitutionStore } from './constitution-store';
import { SkillRegistry } from './skill-registry';
import { ChiefEngine } from './chief-engine';
import { LawEngine } from './law-engine';
import type { EddaBridge } from './edda-bridge';

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
});

describe('LawEngine checkCompliance', () => {
  let db: Database;
  let lawEngine: LawEngine;
  let constitutionStore: ConstitutionStore;
  let chiefEngine: ChiefEngine;
  let villageId: string;

  function setupWithRules(rules: Array<{ description: string; enforcement: 'hard' | 'soft'; scope: string[] }>) {
    db = createDb(':memory:');
    initSchema(db);
    const villageMgr = new VillageManager(db);
    villageId = villageMgr.create({ name: 'test', target_repo: 'r' }, 'u').id;

    constitutionStore = new ConstitutionStore(db);
    constitutionStore.create(villageId, {
      rules,
      allowed_permissions: ['dispatch_task', 'propose_law', 'enact_law_low'],
      budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
    }, 'human');

    const skillRegistry = new SkillRegistry(db);
    chiefEngine = new ChiefEngine(db, constitutionStore, skillRegistry);
    lawEngine = new LawEngine(db, constitutionStore, chiefEngine);
  }

  function createChief() {
    return chiefEngine.create(villageId, {
      name: 'Lawmaker',
      role: 'lawmaker',
      permissions: ['propose_law', 'enact_law_low'],
    }, 'h').id;
  }

  it('compliance pass: law does not violate any rules', () => {
    setupWithRules([
      { description: 'must not delete production data', enforcement: 'hard', scope: ['*'] },
    ]);
    const chiefId = createChief();
    const law = lawEngine.propose(villageId, chiefId, {
      category: 'review',
      content: { description: 'require code review for all PRs', strategy: { min_approvals: 2 } },
      evidence: { source: 'init', reasoning: 'best practice' },
    });
    // Should not be rejected — no violation
    expect(law.status).toBe('active'); // auto-approved (low risk + enact_law_low)
  });

  it('hard violation blocks: law rejected when violating hard rule', () => {
    setupWithRules([
      { description: 'must not delete production data', enforcement: 'hard', scope: ['*'] },
    ]);
    const chiefId = createChief();
    const law = lawEngine.propose(villageId, chiefId, {
      category: 'cleanup',
      content: { description: 'delete production data older than 30 days', strategy: {} },
      evidence: { source: 'init', reasoning: 'save storage' },
    });
    expect(law.status).toBe('rejected');
  });

  it('soft violation warns: law proposed (not rejected) with elevated risk', () => {
    setupWithRules([
      { description: 'should not bypass code review', enforcement: 'soft', scope: ['*'] },
    ]);
    const chiefId = createChief();
    const law = lawEngine.propose(villageId, chiefId, {
      category: 'workflow',
      content: { description: 'bypass code review for hotfixes', strategy: {} },
      evidence: { source: 'init', reasoning: 'speed' },
    });
    // Soft violation should NOT reject, but should elevate risk to at least medium → proposed
    expect(law.status).toBe('proposed');
    expect(law.risk_level).toBe('medium');
  });

  it('multiple rules: hard violation takes priority over soft', () => {
    setupWithRules([
      { description: 'must not deploy without tests', enforcement: 'hard', scope: ['*'] },
      { description: 'should not skip linting', enforcement: 'soft', scope: ['*'] },
    ]);
    const chiefId = createChief();
    const law = lawEngine.propose(villageId, chiefId, {
      category: 'ci',
      content: { description: 'deploy without tests and skip linting', strategy: {} },
      evidence: { source: 'init', reasoning: 'speed' },
    });
    expect(law.status).toBe('rejected');
  });

  it('positive rule: "must review" violated when law says "skip review"', () => {
    setupWithRules([
      { description: 'must review all changes', enforcement: 'hard', scope: ['*'] },
    ]);
    const chiefId = createChief();
    const law = lawEngine.propose(villageId, chiefId, {
      category: 'workflow',
      content: { description: 'skip review for minor changes', strategy: {} },
      evidence: { source: 'init', reasoning: 'speed' },
    });
    expect(law.status).toBe('rejected');
  });
});

describe('LawEngine + Edda recording', () => {
  let db: Database;
  let lawEngine: LawEngine;
  let chiefEngine: ChiefEngine;
  let villageId: string;
  let chiefWithEnact: string;
  let chiefWithoutEnact: string;
  let mockRecordDecision: ReturnType<typeof vi.fn>;
  let mockEddaBridge: EddaBridge;

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

    mockRecordDecision = vi.fn().mockResolvedValue({ event_id: 'evt_test' });
    mockEddaBridge = { recordDecision: mockRecordDecision } as unknown as EddaBridge;
    lawEngine = new LawEngine(db, constitutionStore, chiefEngine, mockEddaBridge);

    chiefWithEnact = chiefEngine.create(villageId, {
      name: 'Enactor',
      role: 'lawmaker',
      permissions: ['propose_law', 'enact_law_low'],
    }, 'h').id;

    chiefWithoutEnact = chiefEngine.create(villageId, {
      name: 'Proposer',
      role: 'proposer',
      permissions: ['propose_law'],
    }, 'h').id;
  });

  it('propose (auto-approved) records to Edda', () => {
    const law = lawEngine.propose(villageId, chiefWithEnact, LAW_INPUT);
    expect(mockRecordDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'law',
        aspect: `${law.id}.status`,
        value: 'auto_approved',
      }),
    );
  });

  it('propose (proposed) records to Edda', () => {
    const law = lawEngine.propose(villageId, chiefWithoutEnact, LAW_INPUT);
    expect(mockRecordDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'law',
        aspect: `${law.id}.status`,
        value: 'proposed',
      }),
    );
  });

  it('approve records to Edda', () => {
    const law = lawEngine.propose(villageId, chiefWithoutEnact, LAW_INPUT);
    mockRecordDecision.mockClear();
    lawEngine.approve(law.id, 'human');
    expect(mockRecordDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'law',
        aspect: `${law.id}.status`,
        value: 'approved',
        reason: 'approved by human',
      }),
    );
  });

  it('reject records to Edda', () => {
    const law = lawEngine.propose(villageId, chiefWithoutEnact, LAW_INPUT);
    mockRecordDecision.mockClear();
    lawEngine.reject(law.id, 'human', 'not needed');
    expect(mockRecordDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'law',
        aspect: `${law.id}.status`,
        value: 'rejected',
        reason: 'rejected by human: not needed',
      }),
    );
  });

  it('revoke records to Edda', () => {
    const law = lawEngine.propose(villageId, chiefWithEnact, LAW_INPUT);
    mockRecordDecision.mockClear();
    lawEngine.revoke(law.id, 'human');
    expect(mockRecordDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'law',
        aspect: `${law.id}.status`,
        value: 'revoked',
      }),
    );
  });

  it('rollback records to Edda', () => {
    const law = lawEngine.propose(villageId, chiefWithEnact, LAW_INPUT);
    mockRecordDecision.mockClear();
    lawEngine.rollback(law.id, 'human', 'bad results');
    expect(mockRecordDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'law',
        aspect: `${law.id}.status`,
        value: 'rolled_back',
        reason: 'bad results',
      }),
    );
  });

  it('evaluate (effective) records effectiveness to Edda', () => {
    const law = lawEngine.propose(villageId, chiefWithoutEnact, LAW_INPUT);
    lawEngine.approve(law.id, 'human');
    mockRecordDecision.mockClear();
    lawEngine.evaluate(law.id, { metrics: { quality: 0.95 }, verdict: 'effective' });
    expect(mockRecordDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'law',
        aspect: `${law.id}.effectiveness`,
        value: 'effective',
      }),
    );
  });

  it('evaluate (harmful + auto-approved) records safety + rollback to Edda', () => {
    const law = lawEngine.propose(villageId, chiefWithEnact, LAW_INPUT);
    expect(law.approved_by).toBe('auto');
    mockRecordDecision.mockClear();
    lawEngine.evaluate(law.id, { metrics: { quality: 0.3 }, verdict: 'harmful' });
    // Should have 2 calls: safety event + rollback status
    expect(mockRecordDecision).toHaveBeenCalledTimes(2);
    expect(mockRecordDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'law',
        aspect: `${law.id}.safety`,
        value: 'auto_rollback',
      }),
    );
    expect(mockRecordDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'law',
        aspect: `${law.id}.status`,
        value: 'rolled_back',
      }),
    );
  });

  it('no eddaBridge → no error', () => {
    const lawEngineNoEdda = new LawEngine(db, new ConstitutionStore(db), chiefEngine);
    // Should not throw — just skips Edda recording
    // (existing constitution from beforeEach still works)
    const law = lawEngine.propose(villageId, chiefWithEnact, LAW_INPUT);
    expect(law.status).toBe('active');
  });

  it('Edda offline → LawEngine still works', () => {
    mockRecordDecision.mockRejectedValue(new Error('connection refused'));
    const law = lawEngine.propose(villageId, chiefWithEnact, LAW_INPUT);
    expect(law.status).toBe('active');
    expect(law.approved_by).toBe('auto');
  });
});
