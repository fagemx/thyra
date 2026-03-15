import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { createDb, initSchema } from './db';
import { VillageManager } from './village-manager';
import { ConstitutionStore } from './constitution-store';
import { ChiefEngine } from './chief-engine';
import { LawEngine } from './law-engine';
import { RiskAssessor } from './risk-assessor';
import { SkillRegistry } from './skill-registry';
import { generateBrief, answerQuestion, executeCommand } from './village-governance';
import type { GovernanceDeps } from './village-governance';

describe('village-governance', () => {
  let db: Database;
  let deps: GovernanceDeps;
  let villageId: string;

  beforeEach(() => {
    db = createDb(':memory:');
    initSchema(db);

    const villageMgr = new VillageManager(db);
    const constitutionStore = new ConstitutionStore(db);
    const skillRegistry = new SkillRegistry(db);
    const chiefEngine = new ChiefEngine(db, constitutionStore, skillRegistry);
    const lawEngine = new LawEngine(db, constitutionStore, chiefEngine);
    const riskAssessor = new RiskAssessor(db);

    deps = { db, villageMgr, constitutionStore, chiefEngine, lawEngine, riskAssessor };

    // 建立 village
    const village = villageMgr.create({ name: 'TestVillage', target_repo: 'fagemx/test' }, 'human');
    villageId = village.id;
  });

  // ---- Brief ----

  describe('generateBrief', () => {
    it('returns brief for village without constitution', () => {
      const brief = generateBrief(deps, villageId, { depth: 'summary' });
      expect(brief.village.name).toBe('TestVillage');
      expect(brief.constitution.active).toBeNull();
      expect(brief.chiefs.active_count).toBe(0);
      expect(brief.laws.active_count).toBe(0);
      expect(brief.loops.running_count).toBe(0);
      expect(brief.budget.limits).toBeNull();
      expect(brief.generated_at).toBeTruthy();
    });

    it('returns brief with constitution and chiefs', () => {
      // 建立 constitution
      deps.constitutionStore.create(villageId, {
        rules: [{ description: 'must review code', enforcement: 'hard', scope: ['*'] }],
        allowed_permissions: ['propose_law', 'enact_law_low'],
        budget_limits: { max_cost_per_action: 5, max_cost_per_day: 50, max_cost_per_loop: 20 },
      }, 'human');

      // 建立 chief
      deps.chiefEngine.create(villageId, {
        name: 'ReviewBot',
        role: 'code reviewer',
        permissions: ['propose_law'],
        personality: { risk_tolerance: 'conservative', communication_style: 'concise', decision_speed: 'deliberate' },
        constraints: [],
        skills: [],
      }, 'human');

      const brief = generateBrief(deps, villageId, { depth: 'summary' });
      expect(brief.constitution.active).not.toBeNull();
      expect(brief.chiefs.active_count).toBe(1);
      expect(brief.budget.limits?.max_cost_per_day).toBe(50);
    });

    it('detailed depth shows more data', () => {
      const brief = generateBrief(deps, villageId, { depth: 'detailed' });
      expect(brief.village.name).toBe('TestVillage');
    });

    it('throws for non-existent village', () => {
      expect(() => generateBrief(deps, 'village-nonexistent', { depth: 'summary' }))
        .toThrow('Village not found');
    });
  });

  // ---- Ask ----

  describe('answerQuestion', () => {
    it('answers constitution question', () => {
      deps.constitutionStore.create(villageId, {
        rules: [{ description: 'must review code', enforcement: 'hard', scope: ['*'] }],
        allowed_permissions: ['propose_law'],
        budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
      }, 'human');

      const answer = answerQuestion(deps, villageId, { question: 'What are the constitution rules?' });
      expect(answer.topic).toBe('constitution');
      expect(answer.answer).toContain('must review code');
      expect(answer.sources.length).toBeGreaterThan(0);
    });

    it('answers chief question', () => {
      deps.constitutionStore.create(villageId, {
        rules: [{ description: 'must follow guidelines', enforcement: 'soft', scope: ['*'] }],
        allowed_permissions: ['propose_law'],
        budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
      }, 'human');
      deps.chiefEngine.create(villageId, {
        name: 'Bot',
        role: 'reviewer',
        permissions: ['propose_law'],
        personality: { risk_tolerance: 'moderate', communication_style: 'concise', decision_speed: 'fast' },
        constraints: [],
        skills: [],
      }, 'human');

      const answer = answerQuestion(deps, villageId, { question: 'Who are the chiefs?' });
      expect(answer.topic).toBe('chiefs');
      expect(answer.answer).toContain('Bot');
    });

    it('answers budget question', () => {
      deps.constitutionStore.create(villageId, {
        rules: [{ description: 'must follow guidelines', enforcement: 'soft', scope: ['*'] }],
        allowed_permissions: ['propose_law'],
        budget_limits: { max_cost_per_action: 5, max_cost_per_day: 50, max_cost_per_loop: 25 },
      }, 'human');

      const answer = answerQuestion(deps, villageId, { question: 'What is the budget?' });
      expect(answer.topic).toBe('budget');
      expect(answer.answer).toContain('$50');
    });

    it('answers law question', () => {
      const answer = answerQuestion(deps, villageId, { question: 'How many laws are active?' });
      expect(answer.topic).toBe('laws');
      expect(answer.answer).toContain('Total laws');
    });

    it('answers loop question', () => {
      const answer = answerQuestion(deps, villageId, { question: 'Are any loops running?' });
      expect(answer.topic).toBe('loops');
      expect(answer.answer).toContain('running');
    });

    it('answers skill question', () => {
      const answer = answerQuestion(deps, villageId, { question: 'What skills are available?' });
      expect(answer.topic).toBe('skills');
    });

    it('answers general question', () => {
      const answer = answerQuestion(deps, villageId, { question: 'Tell me about this village' });
      expect(answer.topic).toBe('general');
      expect(answer.answer).toContain('TestVillage');
    });

    it('throws for non-existent village', () => {
      expect(() => answerQuestion(deps, 'village-xxx', { question: 'hi' }))
        .toThrow('Village not found');
    });
  });

  // ---- Command ----

  describe('executeCommand', () => {
    it('approves low-risk command with constitution', () => {
      deps.constitutionStore.create(villageId, {
        rules: [{ description: 'must follow guidelines', enforcement: 'soft', scope: ['*'] }],
        allowed_permissions: ['propose_law'],
        budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
      }, 'human');

      const result = executeCommand(deps, villageId, {
        action: 'run_lint',
        description: 'Run linting on codebase',
        estimated_cost: 1,
        reason: 'Ensure code quality',
        rollback_plan: 'No changes to revert',
        initiated_by: 'human',
      });

      expect(result.assessment.level).toBe('low');
      expect(result.approved).toBe(true);
      expect(result.message).toContain('approved');
    });

    it('blocks command that violates safety invariant (no rollback plan)', () => {
      const result = executeCommand(deps, villageId, {
        action: 'deploy_production',
        description: 'Deploy to production',
        estimated_cost: 1,
        reason: 'Release new features',
        rollback_plan: '', // empty rollback plan → SI-3 violation
        initiated_by: 'human',
      });

      expect(result.assessment.blocked).toBe(true);
      expect(result.approved).toBe(false);
      expect(result.message).toContain('blocked');
    });

    it('blocks command exceeding budget', () => {
      deps.constitutionStore.create(villageId, {
        rules: [{ description: 'must follow guidelines', enforcement: 'soft', scope: ['*'] }],
        allowed_permissions: ['propose_law'],
        budget_limits: { max_cost_per_action: 5, max_cost_per_day: 100, max_cost_per_loop: 50 },
      }, 'human');

      const result = executeCommand(deps, villageId, {
        action: 'expensive_op',
        description: 'Expensive operation',
        estimated_cost: 20,
        reason: 'Need expensive compute',
        rollback_plan: 'Revert output',
        initiated_by: 'human',
      });

      // SI-4: single action exceeds per-action limit
      expect(result.assessment.blocked).toBe(true);
      expect(result.approved).toBe(false);
    });

    it('flags medium-risk command (deploy)', () => {
      deps.constitutionStore.create(villageId, {
        rules: [{ description: 'must follow guidelines', enforcement: 'soft', scope: ['*'] }],
        allowed_permissions: ['propose_law'],
        budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
      }, 'human');

      const result = executeCommand(deps, villageId, {
        action: 'deploy',
        description: 'Deploy to staging',
        estimated_cost: 2,
        reason: 'Release staging build',
        rollback_plan: 'Revert deploy',
        initiated_by: 'human',
      });

      // deploy triggers H-1 heuristic → medium
      expect(result.assessment.level).toBe('medium');
      expect(result.approved).toBe(false);
      expect(result.message).toContain('confirmation');
    });

    it('throws for non-existent village', () => {
      expect(() => executeCommand(deps, 'village-xxx', {
        action: 'test',
        description: 'test',
        estimated_cost: 0,
        reason: 'test',
        rollback_plan: 'none',
        initiated_by: 'human',
      })).toThrow('Village not found');
    });

    it('records command to audit log', () => {
      deps.constitutionStore.create(villageId, {
        rules: [{ description: 'must follow guidelines', enforcement: 'soft', scope: ['*'] }],
        allowed_permissions: ['propose_law'],
        budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
      }, 'human');

      executeCommand(deps, villageId, {
        action: 'test_action',
        description: 'Test description',
        estimated_cost: 1,
        reason: 'Testing audit',
        rollback_plan: 'Revert test',
        initiated_by: 'tester',
      });

      const audit = db.prepare(
        "SELECT * FROM audit_log WHERE entity_type = 'governance_command' AND entity_id = ?"
      ).get(villageId) as Record<string, unknown> | null;
      expect(audit).not.toBeNull();
      expect(audit?.actor).toBe('tester');
    });
  });
});
