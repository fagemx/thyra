import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { initSchema } from '../db';
import { seedBlogVillage, SKILL_NAMES } from './blog-village';
import type { SeedResult } from './blog-village';
import { VillageManager } from '../village-manager';
import { ConstitutionStore } from '../constitution-store';
import { ChiefEngine } from '../chief-engine';
import { LawEngine } from '../law-engine';
import { SkillRegistry } from '../skill-registry';
import { LoopRunner } from '../loop-runner';
import { RiskAssessor } from '../risk-assessor';

describe('seedBlogVillage', () => {
  let db: Database;
  let result: SeedResult;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    initSchema(db);
    result = seedBlogVillage(db);
  });

  // ── Village ──────────────────────────────────────────────

  it('建立 village：name=blog-village, status=active', () => {
    expect(result.village.id).toMatch(/^village-/);
    expect(result.village.name).toBe('blog-village');
    expect(result.village.status).toBe('active');
    expect(result.village.target_repo).toBe('fagemx/blog');
    expect(result.village.version).toBe(1);
  });

  // ── Constitution ─────────────────────────────────────────

  it('建立 constitution：3 rules, 5 permissions, budget 設定正確', () => {
    expect(result.constitution.id).toMatch(/^const-/);
    expect(result.constitution.status).toBe('active');
    expect(result.constitution.rules).toHaveLength(3);
    expect(result.constitution.allowed_permissions).toHaveLength(5);
    expect(result.constitution.allowed_permissions).toContain('dispatch_task');
    expect(result.constitution.allowed_permissions).toContain('propose_law');
    expect(result.constitution.allowed_permissions).toContain('enact_law_low');
  });

  it('constitution budget 設定正確', () => {
    expect(result.constitution.budget_limits).toEqual({
      max_cost_per_action: 5,
      max_cost_per_day: 50,
      max_cost_per_loop: 25,
    });
  });

  it('constitution 有 hard enforcement rule', () => {
    const hardRules = result.constitution.rules.filter((r) => r.enforcement === 'hard');
    expect(hardRules.length).toBeGreaterThanOrEqual(2);
  });

  // ── Skills ───────────────────────────────────────────────

  it('建立 4 個 skills，全部 verified', () => {
    expect(result.skills).toHaveLength(4);
    for (const skill of result.skills) {
      expect(skill.status).toBe('verified');
      expect(skill.verified_at).not.toBeNull();
      expect(skill.verified_by).toBe('seed:blog-village');
    }
  });

  it('skill 名稱對應 DecisionEngine stageMap keys', () => {
    const names = result.skills.map((s) => s.name);
    // stageMap: research→draft, draft→review, review→publish
    expect(names).toContain('research');
    expect(names).toContain('draft');
    expect(names).toContain('review');
    expect(names).toContain('publish');
  });

  it('skill 名稱符合 /^[a-z0-9-]+$/ 規則', () => {
    for (const skill of result.skills) {
      expect(skill.name).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('SKILL_NAMES 匯出與實際建立的 skill 一致', () => {
    const names = result.skills.map((s) => s.name);
    expect([...SKILL_NAMES]).toEqual(names);
  });

  it('每個 skill 都有 definition 含 prompt_template', () => {
    for (const skill of result.skills) {
      expect(skill.definition.prompt_template.length).toBeGreaterThan(0);
      expect(skill.definition.description.length).toBeGreaterThan(0);
    }
  });

  // ── Chief ────────────────────────────────────────────────

  it('建立 chief：name=editor-chief, status=active', () => {
    expect(result.chief.id).toMatch(/^chief-/);
    expect(result.chief.name).toBe('editor-chief');
    expect(result.chief.status).toBe('active');
    expect(result.chief.version).toBe(1);
  });

  it('chief personality 是 conservative', () => {
    expect(result.chief.personality.risk_tolerance).toBe('conservative');
    expect(result.chief.personality.communication_style).toBe('detailed');
    expect(result.chief.personality.decision_speed).toBe('cautious');
  });

  it('chief permissions ⊆ constitution allowed_permissions（THY-09）', () => {
    const allowed = new Set(result.constitution.allowed_permissions);
    for (const perm of result.chief.permissions) {
      expect(allowed.has(perm)).toBe(true);
    }
  });

  it('chief 綁定 4 個 verified skills（THY-14）', () => {
    expect(result.chief.skills).toHaveLength(4);
    const skillIds = new Set(result.skills.map((s) => s.id));
    for (const binding of result.chief.skills) {
      expect(skillIds.has(binding.skill_id)).toBe(true);
    }
  });

  it('chief 有 3 個 constraints', () => {
    expect(result.chief.constraints).toHaveLength(3);
    const types = result.chief.constraints.map((c) => c.type);
    expect(types).toContain('must');
    expect(types).toContain('must_not');
    expect(types).toContain('prefer');
  });

  // ── 整合：Loop cycle 可啟動 ──────────────────────────────

  it('使用 seed 資料可以啟動 loop cycle', () => {
    const cs = new ConstitutionStore(db);
    const sr = new SkillRegistry(db);
    const ce = new ChiefEngine(db, cs, sr);
    const le = new LawEngine(db, cs, ce);
    const ra = new RiskAssessor(db);
    const lr = new LoopRunner(db, cs, ce, le, ra);

    const cycle = lr.startCycle(result.village.id, {
      chief_id: result.chief.id,
      trigger: 'manual',
    });

    expect(cycle.id).toMatch(/^cycle-/);
    expect(cycle.status).toBe('running');
    expect(cycle.village_id).toBe(result.village.id);
    expect(cycle.chief_id).toBe(result.chief.id);
  });

  // ── 整合：Law propose 可運作 ─────────────────────────────

  it('使用 seed 資料可以 propose law', () => {
    const cs = new ConstitutionStore(db);
    const sr = new SkillRegistry(db);
    const ce = new ChiefEngine(db, cs, sr);
    const le = new LawEngine(db, cs, ce);

    const law = le.propose(result.village.id, result.chief.id, {
      category: 'topic-mix',
      content: {
        description: '每週至少發佈 2 篇技術文章和 1 篇觀點文章',
        strategy: { tech_per_week: 2, opinion_per_week: 1 },
      },
      evidence: {
        source: 'content-analytics-2024',
        reasoning: '技術文章帶來較高的 SEO 流量',
      },
    });

    expect(law.id).toMatch(/^law-/);
    // law 建立成功（狀態依 risk 分級決定）
    expect(['proposed', 'active']).toContain(law.status);
  });

  // ── Seed Laws ───────────────────────────────────────────

  it('建立 3 條 laws：topic-mix, publish-schedule, quality-threshold', () => {
    expect(result.laws).toHaveLength(3);
    const categories = result.laws.map((l) => l.category).sort();
    expect(categories).toEqual(['publish-schedule', 'quality-threshold', 'topic-mix']);
  });

  it('所有 seed laws 由 editor-chief 提出', () => {
    for (const law of result.laws) {
      expect(law.proposed_by).toBe(result.chief.id);
      expect(law.village_id).toBe(result.village.id);
    }
  });

  // ── DB 完整性 ────────────────────────────────────────────

  it('所有實體都寫入 DB，可由各自 store 讀回', () => {
    const cs = new ConstitutionStore(db);
    const sr = new SkillRegistry(db);
    const ce = new ChiefEngine(db, cs, sr);
    const vMgr = new VillageManager(db);

    expect(vMgr.get(result.village.id)).not.toBeNull();
    expect(cs.getActive(result.village.id)).not.toBeNull();
    expect(ce.get(result.chief.id)).not.toBeNull();
    for (const skill of result.skills) {
      expect(sr.get(skill.id)).not.toBeNull();
    }
  });
});
