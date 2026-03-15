import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { createDb, initSchema } from './db';
import { VillageManager } from './village-manager';
import { ConstitutionStore } from './constitution-store';
import { SkillRegistry } from './skill-registry';
import { ChiefEngine } from './chief-engine';
import { LawEngine } from './law-engine';
import { RiskAssessor } from './risk-assessor';
import { DecisionEngine } from './decision-engine';
import type { CycleState, ActionIntent, DecideContext } from './decision-engine';
import { filterCandidates } from './candidate-filter';
import type { CandidateIntentDraft } from './llm-advisor';
import {
  CandidateIntentDraftSchema,
  CandidateIntentDraftsSchema,
  MAX_LLM_CANDIDATES,
  DefaultLlmAdvisor,
  createMockLlmAdvisor,
} from './llm-advisor';
import type { LlmClient } from './llm-advisor';

describe('CandidateIntentDraft', () => {
  // -----------------------------------------------------------------------
  // Zod Schema 驗證
  // -----------------------------------------------------------------------

  describe('Zod schemas', () => {
    it('CandidateIntentDraftSchema accepts valid input', () => {
      const valid = {
        task_key: 'research',
        payload: { topic: 'AI' },
        estimated_cost: 5,
        reason: 'need research data',
      };
      const result = CandidateIntentDraftSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('CandidateIntentDraftSchema defaults payload to empty object', () => {
      const input = {
        task_key: 'research',
        estimated_cost: 5,
        reason: 'need data',
      };
      const result = CandidateIntentDraftSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.payload).toEqual({});
      }
    });

    it('CandidateIntentDraftSchema rejects empty task_key', () => {
      const invalid = {
        task_key: '',
        estimated_cost: 5,
        reason: 'need data',
      };
      const result = CandidateIntentDraftSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('CandidateIntentDraftSchema rejects negative cost', () => {
      const invalid = {
        task_key: 'research',
        estimated_cost: -1,
        reason: 'need data',
      };
      const result = CandidateIntentDraftSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('CandidateIntentDraftsSchema enforces max 3 candidates', () => {
      const tooMany = {
        candidates: [
          { task_key: 'a', estimated_cost: 1, reason: 'r1' },
          { task_key: 'b', estimated_cost: 1, reason: 'r2' },
          { task_key: 'c', estimated_cost: 1, reason: 'r3' },
          { task_key: 'd', estimated_cost: 1, reason: 'r4' },
        ],
      };
      const result = CandidateIntentDraftsSchema.safeParse(tooMany);
      expect(result.success).toBe(false);
    });

    it('CandidateIntentDraftsSchema accepts 3 candidates', () => {
      const valid = {
        candidates: [
          { task_key: 'a', estimated_cost: 1, reason: 'r1' },
          { task_key: 'b', estimated_cost: 1, reason: 'r2' },
          { task_key: 'c', estimated_cost: 1, reason: 'r3' },
        ],
      };
      const result = CandidateIntentDraftsSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('MAX_LLM_CANDIDATES is 3', () => {
      expect(MAX_LLM_CANDIDATES).toBe(3);
    });
  });

  // -----------------------------------------------------------------------
  // Filter Pipeline 整合測試
  // -----------------------------------------------------------------------

  describe('filterCandidates pipeline', () => {
    let db: Database;
    let constitutionStore: ConstitutionStore;
    let chiefEngine: ChiefEngine;
    let lawEngine: LawEngine;
    let skillRegistry: SkillRegistry;
    let riskAssessor: RiskAssessor;
    let villageId: string;
    let chiefId: string;
    let engine: DecisionEngine;

    const baseCycleState: CycleState = {
      cycle_id: 'cycle-filter-test',
      iteration: 0,
      max_iterations: 10,
    };

    beforeEach(() => {
      db = createDb(':memory:');
      initSchema(db);

      const villageMgr = new VillageManager(db);
      villageId = villageMgr.create({ name: 'filter-village', target_repo: 'fagemx/test' }, 'human').id;

      constitutionStore = new ConstitutionStore(db);
      constitutionStore.create(villageId, {
        rules: [
          { description: 'Must not delete production data', enforcement: 'hard', scope: ['*'] },
          { description: 'basic rule', enforcement: 'soft', scope: ['*'] },
        ],
        allowed_permissions: ['dispatch_task', 'propose_law', 'enact_law_low'],
        budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
      }, 'human');

      skillRegistry = new SkillRegistry(db);
      chiefEngine = new ChiefEngine(db, constitutionStore, skillRegistry);
      lawEngine = new LawEngine(db, constitutionStore, chiefEngine);
      riskAssessor = new RiskAssessor(db);

      // 建立 verified skills
      const researchSkill = skillRegistry.create({
        name: 'research',
        definition: {
          description: 'Research skill',
          prompt_template: 'Research',
          tools_required: [],
          constraints: [],
        },
      }, 'human');
      skillRegistry.verify(researchSkill.id, 'human');

      const draftSkill = skillRegistry.create({
        name: 'draft',
        definition: {
          description: 'Draft skill',
          prompt_template: 'Draft',
          tools_required: [],
          constraints: [],
        },
      }, 'human');
      skillRegistry.verify(draftSkill.id, 'human');

      chiefId = chiefEngine.create(villageId, {
        name: 'FilterChief',
        role: 'governor',
        permissions: ['dispatch_task', 'propose_law', 'enact_law_low'],
        constraints: [
          { type: 'must_not', description: 'spam users' },
        ],
      }, 'human').id;

      // 建立 active law
      lawEngine.propose(villageId, chiefId, {
        category: 'testing',
        content: { description: 'test law', strategy: {} },
        evidence: { source: 'test', reasoning: 'testing' },
      });

      engine = new DecisionEngine(
        db, constitutionStore, chiefEngine, lawEngine,
        skillRegistry, riskAssessor, null,
      );
    });

    // --- Step 1: task_key exists in SkillRegistry ---

    it('Step 1: rejects candidate with unknown task_key', async () => {
      const ctx = await engine.buildContext(villageId, chiefId, [], baseCycleState);
      const drafts: CandidateIntentDraft[] = [{
        task_key: 'nonexistent_skill',
        payload: {},
        estimated_cost: 5,
        reason: 'testing unknown skill',
      }];

      const result = filterCandidates(drafts, ctx, [], skillRegistry, db);
      expect(result.accepted).toHaveLength(0);
      expect(result.discarded).toHaveLength(1);
      expect(result.discarded[0].reject_step).toBe(1);
      expect(result.discarded[0].reject_reason).toContain('not found');
    });

    it('Step 1: accepts candidate with verified task_key', async () => {
      const ctx = await engine.buildContext(villageId, chiefId, [], baseCycleState);
      const drafts: CandidateIntentDraft[] = [{
        task_key: 'research',
        payload: {},
        estimated_cost: 5,
        reason: 'start research',
      }];

      const result = filterCandidates(drafts, ctx, [], skillRegistry, db);
      expect(result.accepted).toHaveLength(1);
      expect(result.accepted[0].task_key).toBe('research');
    });

    // --- Step 2: budget check ---

    it('Step 2: rejects candidate exceeding daily budget remaining', async () => {
      const ctx = await engine.buildContext(villageId, chiefId, [], baseCycleState);
      const drafts: CandidateIntentDraft[] = [{
        task_key: 'research',
        payload: {},
        estimated_cost: 999, // 遠超 budget
        reason: 'expensive research',
      }];

      const result = filterCandidates(drafts, ctx, [], skillRegistry, db);
      expect(result.accepted).toHaveLength(0);
      expect(result.discarded).toHaveLength(1);
      expect(result.discarded[0].reject_step).toBe(2);
      expect(result.discarded[0].reject_reason).toContain('budget_remaining');
    });

    it('Step 2: rejects candidate exceeding per-action limit', async () => {
      const ctx = await engine.buildContext(villageId, chiefId, [], baseCycleState);
      const drafts: CandidateIntentDraft[] = [{
        task_key: 'research',
        payload: {},
        estimated_cost: 15, // max_cost_per_action = 10
        reason: 'slightly expensive',
      }];

      const result = filterCandidates(drafts, ctx, [], skillRegistry, db);
      expect(result.accepted).toHaveLength(0);
      expect(result.discarded).toHaveLength(1);
      expect(result.discarded[0].reject_step).toBe(2);
      expect(result.discarded[0].reject_reason).toContain('per_action_limit');
    });

    // --- Step 3: Chief must_not constraints ---

    it('Step 3: rejects candidate violating must_not constraint', async () => {
      const ctx = await engine.buildContext(villageId, chiefId, [], baseCycleState);
      const drafts: CandidateIntentDraft[] = [{
        task_key: 'research',
        payload: {},
        estimated_cost: 5,
        reason: 'spam users with notifications',
      }];

      const result = filterCandidates(drafts, ctx, [], skillRegistry, db);
      expect(result.accepted).toHaveLength(0);
      expect(result.discarded).toHaveLength(1);
      expect(result.discarded[0].reject_step).toBe(3);
      expect(result.discarded[0].reject_reason).toContain('must_not');
    });

    // --- Step 4: Constitution rules pre-check ---

    it('Step 4: rejects candidate violating constitution hard rule', async () => {
      const ctx = await engine.buildContext(villageId, chiefId, [], baseCycleState);
      const drafts: CandidateIntentDraft[] = [{
        task_key: 'research',
        payload: {},
        estimated_cost: 5,
        reason: 'delete production data for cleanup',
      }];

      const result = filterCandidates(drafts, ctx, [], skillRegistry, db);
      expect(result.accepted).toHaveLength(0);
      expect(result.discarded).toHaveLength(1);
      expect(result.discarded[0].reject_step).toBe(4);
      expect(result.discarded[0].reject_reason).toContain('Constitution rule violation');
    });

    // --- Step 5: duplicate check ---

    it('Step 5: rejects duplicate task_key', async () => {
      const ctx = await engine.buildContext(villageId, chiefId, [], baseCycleState);
      const existingCandidates: ActionIntent[] = [{
        kind: 'dispatch_task',
        task_key: 'research',
        estimated_cost: 5,
        rollback_plan: 'revert',
        reason: 'existing candidate',
        evidence_refs: [],
        confidence: 0.7,
      }];
      const drafts: CandidateIntentDraft[] = [{
        task_key: 'research',
        payload: {},
        estimated_cost: 3,
        reason: 'duplicate research',
      }];

      const result = filterCandidates(drafts, ctx, existingCandidates, skillRegistry, db);
      expect(result.accepted).toHaveLength(0);
      expect(result.discarded).toHaveLength(1);
      expect(result.discarded[0].reject_step).toBe(5);
      expect(result.discarded[0].reject_reason).toContain('Duplicate');
    });

    it('Step 5: rejects duplicate within same batch', async () => {
      const ctx = await engine.buildContext(villageId, chiefId, [], baseCycleState);
      const drafts: CandidateIntentDraft[] = [
        { task_key: 'research', payload: {}, estimated_cost: 3, reason: 'first research' },
        { task_key: 'research', payload: {}, estimated_cost: 4, reason: 'second research' },
      ];

      const result = filterCandidates(drafts, ctx, [], skillRegistry, db);
      expect(result.accepted).toHaveLength(1);
      expect(result.discarded).toHaveLength(1);
      expect(result.discarded[0].reject_step).toBe(5);
    });

    // --- Multiple candidates ---

    it('filters multiple candidates correctly', async () => {
      const ctx = await engine.buildContext(villageId, chiefId, [], baseCycleState);
      const drafts: CandidateIntentDraft[] = [
        { task_key: 'research', payload: {}, estimated_cost: 5, reason: 'valid research' },
        { task_key: 'draft', payload: {}, estimated_cost: 5, reason: 'valid draft' },
        { task_key: 'nonexistent', payload: {}, estimated_cost: 5, reason: 'bad skill' },
      ];

      const result = filterCandidates(drafts, ctx, [], skillRegistry, db);
      expect(result.accepted).toHaveLength(2);
      expect(result.discarded).toHaveLength(1);
      expect(result.accepted[0].task_key).toBe('research');
      expect(result.accepted[1].task_key).toBe('draft');
    });

    // --- Audit log ---

    it('logs discarded candidates to audit_log', async () => {
      const ctx = await engine.buildContext(villageId, chiefId, [], baseCycleState);
      const drafts: CandidateIntentDraft[] = [
        { task_key: 'nonexistent', payload: {}, estimated_cost: 5, reason: 'bad skill' },
        { task_key: 'research', payload: {}, estimated_cost: 999, reason: 'too expensive' },
      ];

      filterCandidates(drafts, ctx, [], skillRegistry, db);

      const logs = db.prepare(
        "SELECT * FROM audit_log WHERE entity_type = 'llm_candidate' AND action = 'filter_rejected'",
      ).all() as Record<string, unknown>[];
      expect(logs).toHaveLength(2);

      const payload0 = JSON.parse(logs[0].payload as string);
      expect(payload0.reject_step).toBe(1);
      expect(payload0.task_key).toBe('nonexistent');

      const payload1 = JSON.parse(logs[1].payload as string);
      expect(payload1.reject_step).toBe(2);
      expect(payload1.task_key).toBe('research');
    });

    // --- ActionIntent 轉換 ---

    it('accepted candidates have correct ActionIntent structure', async () => {
      const ctx = await engine.buildContext(villageId, chiefId, [], baseCycleState);
      const drafts: CandidateIntentDraft[] = [{
        task_key: 'research',
        payload: { topic: 'governance' },
        estimated_cost: 5,
        reason: 'start research on governance',
      }];

      const result = filterCandidates(drafts, ctx, [], skillRegistry, db);
      expect(result.accepted).toHaveLength(1);

      const intent = result.accepted[0];
      expect(intent.kind).toBe('dispatch_task');
      expect(intent.task_key).toBe('research');
      expect(intent.payload).toEqual({ topic: 'governance' });
      expect(intent.estimated_cost).toBe(5);
      expect(intent.rollback_plan).toBe('Revert research output');
      expect(intent.reason).toContain('[LLM]');
      expect(intent.confidence).toBe(0.6);
    });
  });

  // -----------------------------------------------------------------------
  // DecisionEngine 整合 — LLM 候選生成
  // -----------------------------------------------------------------------

  describe('DecisionEngine integration', () => {
    let db: Database;
    let constitutionStore: ConstitutionStore;
    let chiefEngine: ChiefEngine;
    let lawEngine: LawEngine;
    let skillRegistry: SkillRegistry;
    let riskAssessor: RiskAssessor;
    let villageId: string;
    let chiefId: string;

    const baseCycleState: CycleState = {
      cycle_id: 'cycle-integration-test',
      iteration: 0,
      max_iterations: 10,
    };

    beforeEach(() => {
      db = createDb(':memory:');
      initSchema(db);

      const villageMgr = new VillageManager(db);
      villageId = villageMgr.create({ name: 'integration-village', target_repo: 'fagemx/test' }, 'human').id;

      constitutionStore = new ConstitutionStore(db);
      constitutionStore.create(villageId, {
        rules: [{ description: 'basic rule', enforcement: 'soft', scope: ['*'] }],
        allowed_permissions: ['dispatch_task', 'propose_law', 'enact_law_low'],
        budget_limits: { max_cost_per_action: 10, max_cost_per_day: 100, max_cost_per_loop: 50 },
      }, 'human');

      skillRegistry = new SkillRegistry(db);
      chiefEngine = new ChiefEngine(db, constitutionStore, skillRegistry);
      lawEngine = new LawEngine(db, constitutionStore, chiefEngine);
      riskAssessor = new RiskAssessor(db);

      // 建立多個 verified skills
      for (const name of ['research', 'draft', 'review']) {
        const skill = skillRegistry.create({
          name,
          definition: {
            description: `${name} skill`,
            prompt_template: name,
            tools_required: [],
            constraints: [],
          },
        }, 'human');
        skillRegistry.verify(skill.id, 'human');
      }

      chiefId = chiefEngine.create(villageId, {
        name: 'IntegrationChief',
        role: 'governor',
        permissions: ['dispatch_task', 'propose_law', 'enact_law_low'],
        constraints: [],
      }, 'human').id;

      // active law
      lawEngine.propose(villageId, chiefId, {
        category: 'testing',
        content: { description: 'test law', strategy: {} },
        evidence: { source: 'test', reasoning: 'testing' },
      });
    });

    it('LLM candidates are added to rule-based candidates', async () => {
      const advisor = createMockLlmAdvisor({
        candidateDrafts: [
          { task_key: 'draft', payload: {}, estimated_cost: 5, reason: 'LLM suggests draft' },
        ],
      });

      const engine = new DecisionEngine(
        db, constitutionStore, chiefEngine, lawEngine,
        skillRegistry, riskAssessor, null, advisor,
      );

      const ctx = await engine.buildContext(villageId, chiefId, [], baseCycleState);
      const result = await engine.decide(ctx);

      // 應該有 LLM 候選相關的 factor
      expect(result.reasoning.factors.some(f => f.includes('LLM generated'))).toBe(true);
    });

    it('LLM candidates with invalid task_key are filtered and logged', async () => {
      const advisor = createMockLlmAdvisor({
        candidateDrafts: [
          { task_key: 'nonexistent', payload: {}, estimated_cost: 5, reason: 'bad skill' },
        ],
      });

      const engine = new DecisionEngine(
        db, constitutionStore, chiefEngine, lawEngine,
        skillRegistry, riskAssessor, null, advisor,
      );

      const ctx = await engine.buildContext(villageId, chiefId, [], baseCycleState);
      const result = await engine.decide(ctx);

      // 過濾掉的候選有 factor 記錄
      expect(result.reasoning.factors.some(f => f.includes('filtered out'))).toBe(true);

      // audit_log 有記錄
      const logs = db.prepare(
        "SELECT * FROM audit_log WHERE entity_type = 'llm_candidate' AND action = 'filter_rejected'",
      ).all() as Record<string, unknown>[];
      expect(logs).toHaveLength(1);
    });

    it('LLM generateCandidates error falls back gracefully', async () => {
      const advisor = createMockLlmAdvisor();
      // 覆蓋 generateCandidates 使其拋出錯誤
      advisor.generateCandidates = async () => {
        throw new Error('LLM service down');
      };

      const engine = new DecisionEngine(
        db, constitutionStore, chiefEngine, lawEngine,
        skillRegistry, riskAssessor, null, advisor,
      );

      const ctx = await engine.buildContext(villageId, chiefId, [], baseCycleState);
      const result = await engine.decide(ctx);

      // 仍然正常運作（rule-based）
      expect(result.action).not.toBeNull();

      // audit_log 有 fallback 記錄
      const logs = db.prepare(
        "SELECT * FROM audit_log WHERE entity_type = 'llm_advisor' AND action = 'generate_candidates_fallback'",
      ).all() as Record<string, unknown>[];
      expect(logs).toHaveLength(1);
    });

    it('empty LLM candidates does not affect rule-based', async () => {
      const advisor = createMockLlmAdvisor({
        candidateDrafts: [],
      });

      const engine = new DecisionEngine(
        db, constitutionStore, chiefEngine, lawEngine,
        skillRegistry, riskAssessor, null, advisor,
      );

      const ctx = await engine.buildContext(villageId, chiefId, [], baseCycleState);
      const result = await engine.decide(ctx);

      // rule-based 正常
      expect(result.action).not.toBeNull();
      expect(result.action!.kind).toBe('dispatch_task');
    });

    it('DefaultLlmAdvisor.generateCandidates with valid LLM response', async () => {
      const client: LlmClient = {
        complete: async (prompt: string) => {
          if (prompt.includes('candidate task intents')) {
            return JSON.stringify({
              candidates: [
                { task_key: 'draft', estimated_cost: 5, reason: 'time to draft' },
              ],
            });
          }
          if (prompt.includes('Evaluate each candidate')) {
            return JSON.stringify({
              selected_index: -1,
              scores: [{ index: 0, score: 0.5, reasoning: 'ok' }],
              overall_reasoning: 'ok',
            });
          }
          if (prompt.includes('Enrich')) {
            return JSON.stringify({
              enriched_summary: '',
              additional_factors: [],
              confidence_adjustment: 0,
            });
          }
          return JSON.stringify({ suggestions: [] });
        },
      };
      const advisor = new DefaultLlmAdvisor(client, db);

      const engine = new DecisionEngine(
        db, constitutionStore, chiefEngine, lawEngine,
        skillRegistry, riskAssessor, null, advisor,
      );

      const ctx = await engine.buildContext(villageId, chiefId, [], baseCycleState);
      const result = await engine.decide(ctx);

      expect(result.action).not.toBeNull();
      expect(result.reasoning.factors.some(f => f.includes('LLM generated'))).toBe(true);
    });

    it('DefaultLlmAdvisor.generateCandidates with invalid JSON falls back', async () => {
      const client: LlmClient = {
        complete: async (prompt: string) => {
          if (prompt.includes('candidate task intents')) {
            return '{ "invalid": true }';
          }
          if (prompt.includes('Evaluate')) {
            return JSON.stringify({
              selected_index: -1,
              scores: [{ index: 0, score: 0.5, reasoning: 'ok' }],
              overall_reasoning: 'ok',
            });
          }
          if (prompt.includes('Enrich')) {
            return JSON.stringify({
              enriched_summary: '',
              additional_factors: [],
              confidence_adjustment: 0,
            });
          }
          return JSON.stringify({ suggestions: [] });
        },
      };
      const advisor = new DefaultLlmAdvisor(client, db);

      const engine = new DecisionEngine(
        db, constitutionStore, chiefEngine, lawEngine,
        skillRegistry, riskAssessor, null, advisor,
      );

      const ctx = await engine.buildContext(villageId, chiefId, [], baseCycleState);
      const result = await engine.decide(ctx);

      // 仍然正常
      expect(result.action).not.toBeNull();

      // fallback 記錄 — DefaultLlmAdvisor.logFallback 使用 entity_id=method_name
      const logs = db.prepare(
        "SELECT * FROM audit_log WHERE entity_type = 'llm_advisor' AND action = 'fallback' AND entity_id = 'generateCandidates'",
      ).all() as Record<string, unknown>[];
      expect(logs.length).toBeGreaterThan(0);
    });
  });
});
