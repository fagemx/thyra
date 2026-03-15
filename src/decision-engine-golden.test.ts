/**
 * Decision Engine — Golden fixture 測試
 *
 * 使用 seedBlogVillage() 建立真實 Blog Village 資料，
 * 搭配 blog-village-context.ts 的工廠函數驗證 decide() 行為。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { initSchema } from './db';
import { seedBlogVillage, type SeedResult } from './seeds/blog-village';
import { DecisionEngine } from './decision-engine';
import { ConstitutionStore } from './constitution-store';
import { ChiefEngine } from './chief-engine';
import { LawEngine } from './law-engine';
import { SkillRegistry } from './skill-registry';
import { RiskAssessor } from './risk-assessor';
import {
  makeColdStartContext,
  makeMidPipelineContext,
  makeBudgetExhaustedContext,
  makeNegativePrecedentContext,
  makeLawRollbackContext,
} from './__fixtures__/blog-village-context';

describe('DecisionEngine golden fixtures (Blog Village)', () => {
  let db: Database;
  let seed: SeedResult;
  let engine: DecisionEngine;

  beforeEach(() => {
    db = new Database(':memory:');
    initSchema(db);
    seed = seedBlogVillage(db);

    const cs = new ConstitutionStore(db);
    const sr = new SkillRegistry(db);
    const ce = new ChiefEngine(db, cs, sr);
    const le = new LawEngine(db, cs, ce);
    const ra = new RiskAssessor(db);

    engine = new DecisionEngine(db, cs, ce, le, sr, ra, null);
  });

  // ── 1. 冷啟動 ──────────────────────────────────────────────

  describe('cold start（無 intent、無歷史）', () => {
    it('應根據 active laws 啟動 pipeline，dispatch research', () => {
      const ctx = makeColdStartContext(
        seed.chief, seed.constitution, seed.skills, seed.laws,
      );
      const result = engine.decide(ctx);

      // 有 active_laws → startPipeline → dispatch research
      expect(result.action).not.toBeNull();
      expect(result.action!.kind).toBe('dispatch_task');
      expect(result.action!.task_key).toBe('research');
      expect(result.reasoning.summary).toContain('research');
    });

    it('沒有 active laws 時，action 為 null', () => {
      const ctx = makeColdStartContext(
        seed.chief, seed.constitution, seed.skills, [],
      );
      const result = engine.decide(ctx);

      expect(result.action).toBeNull();
      expect(result.reasoning.summary).toContain('No action needed');
    });

    it('推理鏈必須包含因素（SI-2）', () => {
      const ctx = makeColdStartContext(
        seed.chief, seed.constitution, seed.skills, seed.laws,
      );
      const result = engine.decide(ctx);

      expect(result.reasoning.factors.length).toBeGreaterThan(0);
      expect(result.reasoning.confidence).toBeGreaterThan(0);
      expect(result.reasoning.confidence).toBeLessThanOrEqual(1);
    });
  });

  // ── 2. 流水線推進 ──────────────────────────────────────────

  describe('mid-pipeline（research → draft）', () => {
    it('應推進到 draft 階段', () => {
      const ctx = makeMidPipelineContext(
        seed.chief, seed.constitution, seed.skills, seed.laws,
      );
      const result = engine.decide(ctx);

      expect(result.action).not.toBeNull();
      expect(result.action!.kind).toBe('dispatch_task');
      expect(result.action!.task_key).toBe('draft');
      expect(result.reasoning.summary).toContain('draft');
    });

    it('updated_intent 應反映新階段', () => {
      const ctx = makeMidPipelineContext(
        seed.chief, seed.constitution, seed.skills, seed.laws,
      );
      const result = engine.decide(ctx);

      expect(result.updated_intent).not.toBeNull();
      expect(result.updated_intent!.stage_hint).toBe('draft');
      expect(result.updated_intent!.goal_kind).toBe('content_pipeline');
    });

    it('estimated_cost 不超過 per_action_limit', () => {
      const ctx = makeMidPipelineContext(
        seed.chief, seed.constitution, seed.skills, seed.laws,
      );
      const result = engine.decide(ctx);

      expect(result.action!.estimated_cost).toBeLessThanOrEqual(
        ctx.budget.per_action_limit,
      );
    });
  });

  // ── 3. 預算耗盡 ──────────────────────────────────────────

  describe('budget exhausted（budget_ratio < 0.1）', () => {
    it('應觸發 complete_cycle', () => {
      const ctx = makeBudgetExhaustedContext(
        seed.chief, seed.constitution, seed.skills, seed.laws,
      );
      const result = engine.decide(ctx);

      expect(result.action).not.toBeNull();
      expect(result.action!.kind).toBe('complete_cycle');
      expect(result.reasoning.summary).toContain('completed');
    });

    it('estimated_cost 為 0（不再花費）', () => {
      const ctx = makeBudgetExhaustedContext(
        seed.chief, seed.constitution, seed.skills, seed.laws,
      );
      const result = engine.decide(ctx);

      expect(result.action!.estimated_cost).toBe(0);
    });

    it('reasoning 應提及 budget', () => {
      const ctx = makeBudgetExhaustedContext(
        seed.chief, seed.constitution, seed.skills, seed.laws,
      );
      const result = engine.decide(ctx);

      // factors 中應有 budget 相關描述
      const hasBudgetFactor = result.reasoning.factors.some(
        f => f.toLowerCase().includes('budget'),
      );
      expect(hasBudgetFactor).toBe(true);
    });
  });

  // ── 4. 負面先例 ──────────────────────────────────────────

  describe('negative precedent（Edda harmful verdict）', () => {
    it('confidence 應低於基線', () => {
      // 無先例的基線 context
      const baseCtx = makeMidPipelineContext(
        seed.chief, seed.constitution, seed.skills, seed.laws,
      );
      const baseResult = engine.decide(baseCtx);

      // 含負面先例
      const negCtx = makeNegativePrecedentContext(
        seed.chief, seed.constitution, seed.skills, seed.laws,
      );
      const negResult = engine.decide(negCtx);

      // conservative chief + harmful precedent → confidence 降低
      expect(negResult.reasoning.confidence).toBeLessThan(
        baseResult.reasoning.confidence,
      );
    });

    it('precedent_notes 應包含負面先例', () => {
      const ctx = makeNegativePrecedentContext(
        seed.chief, seed.constitution, seed.skills, seed.laws,
      );
      const result = engine.decide(ctx);

      expect(result.reasoning.precedent_notes.length).toBeGreaterThan(0);
      const hasNegative = result.reasoning.precedent_notes.some(
        n => n.toLowerCase().includes('negative') || n.toLowerCase().includes('harmful'),
      );
      expect(hasNegative).toBe(true);
    });

    it('action 仍然應該推進（不會完全阻止）', () => {
      const ctx = makeNegativePrecedentContext(
        seed.chief, seed.constitution, seed.skills, seed.laws,
      );
      const result = engine.decide(ctx);

      expect(result.action).not.toBeNull();
      expect(result.action!.kind).toBe('dispatch_task');
    });
  });

  // ── 5. 法律回滾 ──────────────────────────────────────────

  describe('law rollback（recent_rollbacks >= 3）', () => {
    it('應產生 law proposal（策略調整）', () => {
      const ctx = makeLawRollbackContext(
        seed.chief, seed.constitution, seed.skills, seed.laws,
      );
      const result = engine.decide(ctx);

      expect(result.law_proposals.length).toBeGreaterThan(0);
      const adjustProposal = result.law_proposals.find(
        p => p.content.description.toLowerCase().includes('adjust'),
      );
      expect(adjustProposal).toBeDefined();
    });

    it('action 仍應正常產生', () => {
      const ctx = makeLawRollbackContext(
        seed.chief, seed.constitution, seed.skills, seed.laws,
      );
      const result = engine.decide(ctx);

      // 有 intent + last_action executed → 應推進 pipeline
      expect(result.action).not.toBeNull();
      expect(result.action!.kind).toBe('dispatch_task');
    });

    it('law proposal 的 evidence 應有 reasoning', () => {
      const ctx = makeLawRollbackContext(
        seed.chief, seed.constitution, seed.skills, seed.laws,
      );
      const result = engine.decide(ctx);

      for (const proposal of result.law_proposals) {
        expect(proposal.evidence.source).toBeTruthy();
        expect(proposal.evidence.reasoning).toBeTruthy();
      }
    });
  });

  // ── 6. 人格影響 ──────────────────────────────────────────

  describe('personality effect（conservative chief）', () => {
    it('personality_effect 應包含 conservative', () => {
      const ctx = makeColdStartContext(
        seed.chief, seed.constitution, seed.skills, seed.laws,
      );
      const result = engine.decide(ctx);

      expect(result.reasoning.personality_effect).toContain('conservative');
    });

    it('低預算 conservative chief 應傾向 complete_cycle', () => {
      // budget_ratio < 0.3 + conservative → selectBest 傾向 complete_cycle
      // 但這裡 budget_ratio 不到 0.1 會先被規則 5 截斷
      // 所以測試 0.2（介於 0.1 和 0.3 之間）
      const ctx = makeMidPipelineContext(
        seed.chief, seed.constitution, seed.skills, seed.laws,
      );
      ctx.budget_ratio = 0.2;
      const result = engine.decide(ctx);

      // conservative + budget_ratio < 0.3 → confidence 應被降低
      expect(result.reasoning.confidence).toBeLessThan(0.7);
    });
  });
});
