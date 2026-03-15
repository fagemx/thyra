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
import type { CycleState } from './decision-engine';
import {
  AdvisorSelectionSchema,
  ReasoningEnrichmentSchema,
  LawProposalSuggestionsSchema,
  DefaultLlmAdvisor,
  createMockLlmAdvisor,
  createMockLlmClient,
} from './llm-advisor';
import type { LlmClient } from './llm-advisor';

describe('LlmAdvisor', () => {
  let db: Database;
  let constitutionStore: ConstitutionStore;
  let chiefEngine: ChiefEngine;
  let lawEngine: LawEngine;
  let skillRegistry: SkillRegistry;
  let riskAssessor: RiskAssessor;
  let villageId: string;
  let chiefId: string;

  const baseCycleState: CycleState = {
    cycle_id: 'cycle-llm-test',
    iteration: 0,
    max_iterations: 10,
  };

  beforeEach(() => {
    db = createDb(':memory:');
    initSchema(db);

    const villageMgr = new VillageManager(db);
    villageId = villageMgr.create({ name: 'llm-village', target_repo: 'fagemx/test' }, 'human').id;

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

    chiefId = chiefEngine.create(villageId, {
      name: 'LlmChief',
      role: 'governor',
      permissions: ['dispatch_task', 'propose_law', 'enact_law_low'],
      constraints: [],
    }, 'human').id;

    // 建立 verified skill 讓 pipeline 可以產生候選
    const skill = skillRegistry.create({
      name: 'research',
      definition: {
        description: 'Research skill',
        prompt_template: 'Research',
        tools_required: [],
        constraints: [],
      },
    }, 'human');
    skillRegistry.verify(skill.id, 'human');

    // 建立 active law 讓 pipeline 啟動
    lawEngine.propose(villageId, chiefId, {
      category: 'testing',
      content: { description: 'test law', strategy: {} },
      evidence: { source: 'test', reasoning: 'testing' },
    });
  });

  // -----------------------------------------------------------------------
  // Zod Schema 驗證
  // -----------------------------------------------------------------------

  describe('Zod schemas', () => {
    it('AdvisorSelectionSchema accepts valid input', () => {
      const valid = {
        selected_index: 0,
        scores: [{ index: 0, score: 0.8, reasoning: 'good candidate' }],
        overall_reasoning: 'best option',
      };
      const result = AdvisorSelectionSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('AdvisorSelectionSchema rejects invalid score', () => {
      const invalid = {
        selected_index: 0,
        scores: [{ index: 0, score: 1.5, reasoning: 'too high' }],
        overall_reasoning: 'bad',
      };
      const result = AdvisorSelectionSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('ReasoningEnrichmentSchema accepts valid input', () => {
      const valid = {
        enriched_summary: 'better summary',
        additional_factors: ['factor 1'],
        confidence_adjustment: 0.1,
      };
      const result = ReasoningEnrichmentSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('ReasoningEnrichmentSchema rejects out-of-range adjustment', () => {
      const invalid = {
        enriched_summary: 'summary',
        additional_factors: [],
        confidence_adjustment: 0.6,
      };
      const result = ReasoningEnrichmentSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('LawProposalSuggestionsSchema accepts valid suggestions', () => {
      const valid = {
        suggestions: [{
          category: 'safety',
          description: 'new safety law',
          strategy: { enforce: true },
          reasoning: 'needed for compliance',
          trigger: 'high risk detected',
        }],
      };
      const result = LawProposalSuggestionsSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 無 advisor → 純 rule-based（既有行為不變）
  // -----------------------------------------------------------------------

  describe('no advisor (rule-based only)', () => {
    it('decide works without LlmAdvisor', async () => {
      const engine = new DecisionEngine(
        db, constitutionStore, chiefEngine, lawEngine,
        skillRegistry, riskAssessor, null,
      );

      const ctx = await engine.buildContext(villageId, chiefId, [], baseCycleState);
      const result = await engine.decide(ctx);

      // 有 active law → 會產生 dispatch_task(research)
      expect(result.action).not.toBeNull();
      expect(result.action!.kind).toBe('dispatch_task');
      // 不應有 LLM 相關 factors
      expect(result.reasoning.factors.every(f => !f.includes('LLM'))).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Mock LlmAdvisor 整合
  // -----------------------------------------------------------------------

  describe('with mock LlmAdvisor', () => {
    it('advisor re-ranks candidates', async () => {
      const advisor = createMockLlmAdvisor({
        adviseResult: {
          selected_index: 0,
          scores: [{ index: 0, score: 0.9, reasoning: 'excellent choice' }],
          overall_reasoning: 'LLM recommends research',
        },
      });

      const engine = new DecisionEngine(
        db, constitutionStore, chiefEngine, lawEngine,
        skillRegistry, riskAssessor, null, advisor,
      );

      const ctx = await engine.buildContext(villageId, chiefId, [], baseCycleState);
      const result = await engine.decide(ctx);

      expect(result.action).not.toBeNull();
      expect(result.reasoning.factors.some(f => f.includes('LLM advisor'))).toBe(true);
    });

    it('advisor enriches reasoning', async () => {
      const advisor = createMockLlmAdvisor({
        reasoningResult: {
          enriched_summary: 'Deeper analysis shows research is optimal',
          additional_factors: ['Market conditions favor early research'],
          confidence_adjustment: 0.1,
        },
      });

      const engine = new DecisionEngine(
        db, constitutionStore, chiefEngine, lawEngine,
        skillRegistry, riskAssessor, null, advisor,
      );

      const ctx = await engine.buildContext(villageId, chiefId, [], baseCycleState);
      const result = await engine.decide(ctx);

      expect(result.reasoning.factors.some(f => f.includes('Deeper analysis'))).toBe(true);
      expect(result.reasoning.factors.some(f => f.includes('Market conditions'))).toBe(true);
    });

    it('advisor suggests law proposals', async () => {
      const advisor = createMockLlmAdvisor({
        lawSuggestions: [{
          category: 'efficiency',
          description: 'Optimize pipeline scheduling',
          strategy: { batch_size: 5 },
          reasoning: 'Current scheduling is inefficient',
          trigger: 'performance observation',
        }],
      });

      const engine = new DecisionEngine(
        db, constitutionStore, chiefEngine, lawEngine,
        skillRegistry, riskAssessor, null, advisor,
      );

      const ctx = await engine.buildContext(villageId, chiefId, [], baseCycleState);
      const result = await engine.decide(ctx);

      // rule-based + LLM 建議合併
      const llmProposal = result.law_proposals.find(p => p.evidence.source === 'llm_advisor');
      expect(llmProposal).toBeDefined();
      expect(llmProposal!.category).toBe('efficiency');
    });

    it('advisor selected_index=-1 keeps rule-based selection', async () => {
      const advisor = createMockLlmAdvisor({
        adviseResult: {
          selected_index: -1,
          scores: [{ index: 0, score: 0.5, reasoning: 'keep original' }],
          overall_reasoning: 'Rule-based is fine',
        },
      });

      const engine = new DecisionEngine(
        db, constitutionStore, chiefEngine, lawEngine,
        skillRegistry, riskAssessor, null, advisor,
      );

      const ctx = await engine.buildContext(villageId, chiefId, [], baseCycleState);
      const result = await engine.decide(ctx);

      // 原始 rule-based 選擇保持不變
      expect(result.action).not.toBeNull();
      expect(result.action!.kind).toBe('dispatch_task');
    });
  });

  // -----------------------------------------------------------------------
  // DefaultLlmAdvisor + LLM 失敗 → fallback
  // -----------------------------------------------------------------------

  describe('DefaultLlmAdvisor fallback', () => {
    it('LLM error → fallback to rule-based + audit_log', async () => {
      const failingClient: LlmClient = {
        complete: async () => { throw new Error('LLM service unavailable'); },
      };
      const advisor = new DefaultLlmAdvisor(failingClient, db);

      const engine = new DecisionEngine(
        db, constitutionStore, chiefEngine, lawEngine,
        skillRegistry, riskAssessor, null, advisor,
      );

      const ctx = await engine.buildContext(villageId, chiefId, [], baseCycleState);
      const result = await engine.decide(ctx);

      // 仍然正常運作（fallback）
      expect(result.action).not.toBeNull();
      expect(result.action!.kind).toBe('dispatch_task');

      // 檢查 audit_log 有 fallback 記錄
      const logs = db.prepare(
        "SELECT * FROM audit_log WHERE entity_type = 'llm_advisor' AND action = 'fallback'",
      ).all() as Record<string, unknown>[];
      expect(logs.length).toBeGreaterThan(0);
    });

    it('invalid LLM JSON → Zod rejects + fallback', async () => {
      const badClient: LlmClient = {
        complete: async () => '{ "invalid": "structure" }',
      };
      const advisor = new DefaultLlmAdvisor(badClient, db);

      const engine = new DecisionEngine(
        db, constitutionStore, chiefEngine, lawEngine,
        skillRegistry, riskAssessor, null, advisor,
      );

      const ctx = await engine.buildContext(villageId, chiefId, [], baseCycleState);
      const result = await engine.decide(ctx);

      // 仍然正常運作
      expect(result.action).not.toBeNull();

      // 檢查有 Zod validation fallback 記錄
      const logs = db.prepare(
        "SELECT * FROM audit_log WHERE entity_type = 'llm_advisor' AND action = 'fallback'",
      ).all() as Record<string, unknown>[];
      expect(logs.length).toBeGreaterThan(0);
      const payload = JSON.parse(logs[0].payload as string);
      expect(payload.reason).toBe('zod_validation_failed');
    });

    it('valid LLM JSON → advisor processes correctly', async () => {
      const validClient: LlmClient = {
        complete: async (prompt: string) => {
          if (prompt.includes('Evaluate each candidate')) {
            return JSON.stringify({
              selected_index: 0,
              scores: [{ index: 0, score: 0.95, reasoning: 'best choice' }],
              overall_reasoning: 'Research is the right move',
            });
          }
          if (prompt.includes('Enrich the reasoning')) {
            return JSON.stringify({
              enriched_summary: 'LLM enriched',
              additional_factors: ['LLM extra factor'],
              confidence_adjustment: 0.05,
            });
          }
          if (prompt.includes('Suggest law proposals')) {
            return JSON.stringify({ suggestions: [] });
          }
          return '{}';
        },
      };
      const advisor = new DefaultLlmAdvisor(validClient, db);

      const engine = new DecisionEngine(
        db, constitutionStore, chiefEngine, lawEngine,
        skillRegistry, riskAssessor, null, advisor,
      );

      const ctx = await engine.buildContext(villageId, chiefId, [], baseCycleState);
      const result = await engine.decide(ctx);

      expect(result.action).not.toBeNull();
      expect(result.reasoning.factors.some(f => f.includes('LLM enriched'))).toBe(true);
      expect(result.reasoning.factors.some(f => f.includes('LLM extra factor'))).toBe(true);
    });

    it('LLM returns JSON in markdown code block → parsed correctly', async () => {
      const codeBlockClient: LlmClient = {
        complete: async (prompt: string) => {
          if (prompt.includes('Evaluate each candidate')) {
            return '```json\n{"selected_index": -1, "scores": [{"index": 0, "score": 0.7, "reasoning": "ok"}], "overall_reasoning": "fine"}\n```';
          }
          if (prompt.includes('Enrich')) {
            return '```json\n{"enriched_summary": "", "additional_factors": [], "confidence_adjustment": 0}\n```';
          }
          return '```json\n{"suggestions": []}\n```';
        },
      };
      const advisor = new DefaultLlmAdvisor(codeBlockClient, db);

      const engine = new DecisionEngine(
        db, constitutionStore, chiefEngine, lawEngine,
        skillRegistry, riskAssessor, null, advisor,
      );

      const ctx = await engine.buildContext(villageId, chiefId, [], baseCycleState);
      const result = await engine.decide(ctx);

      // 正常運作且無 fallback 記錄
      expect(result.action).not.toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // createMockLlmClient 工廠
  // -----------------------------------------------------------------------

  describe('createMockLlmClient', () => {
    it('returns matching response for prompt substring', async () => {
      const client = createMockLlmClient({
        'Evaluate': '{"selected_index": 0, "scores": [], "overall_reasoning": "ok"}',
      });

      const result = await client.complete('Please Evaluate this');
      expect(result).toContain('selected_index');
    });

    it('throws when no matching response', async () => {
      const client = createMockLlmClient({});
      await expect(client.complete('unknown prompt')).rejects.toThrow('No mock response');
    });
  });
});
