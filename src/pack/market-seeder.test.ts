import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parse as parseYaml } from 'yaml';
import { initSchema } from '../db';
import { VillageManager } from '../village-manager';
import { ConstitutionStore } from '../constitution-store';
import { ChiefEngine } from '../chief-engine';
import { SkillRegistry } from '../skill-registry';
import { ZoneManager } from '../market/zones';
import { parseMarketTemplate } from '../schemas/market-template';
import { assembleWorldState } from '../world/state';
import { assembleMarketState } from '../market/state';
import { seedMarketWorld } from './market-seeder';
import type { MarketSeedDeps } from './market-seeder';
import type { MarketTemplate } from '../schemas/market-template';

// ── Setup ────────────────────────────────────────────────────

const TEMPLATE_PATH = resolve(__dirname, '../../templates/midnight-market.yaml');

const SKILL_NAMES = [
  'event-planning',
  'price-management',
  'safety-patrol',
  'lore-keeper',
  'growth-analysis',
] as const;

const CHIEF_NAMES = [
  'event-chief',
  'economy-chief',
  'safety-chief',
  'lore-chief',
  'growth-chief',
] as const;

function createTestDb(): Database {
  const db = new Database(':memory:');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  initSchema(db);
  return db;
}

function createDeps(db: Database): MarketSeedDeps {
  const villageMgr = new VillageManager(db);
  const constitutionStore = new ConstitutionStore(db);
  const skillRegistry = new SkillRegistry(db);
  const chiefEngine = new ChiefEngine(db, constitutionStore, skillRegistry);
  const zoneManager = new ZoneManager(db);
  return { villageMgr, constitutionStore, chiefEngine, skillRegistry, zoneManager };
}

/** 建立已驗證 skill 供測試用 */
function createVerifiedSkill(registry: SkillRegistry, name: string): string {
  const skill = registry.create(
    {
      name,
      definition: {
        description: `${name} skill`,
        prompt_template: `Do ${name}`,
        tools_required: [],
        constraints: [],
        examples: [],
      },
    },
    'test',
  );
  registry.verify(skill.id, 'test');
  return skill.id;
}

function loadTemplate(): MarketTemplate {
  const raw = readFileSync(TEMPLATE_PATH, 'utf-8');
  const parsed = parseYaml(raw) as unknown;
  const result = parseMarketTemplate(parsed);
  if (!result.success) {
    throw new Error(`Template parse failed: ${JSON.stringify(result.errors)}`);
  }
  return result.data;
}

// ── Tests ────────────────────────────────────────────────────

describe('seedMarketWorld', () => {
  let db: Database;
  let deps: MarketSeedDeps;
  let template: MarketTemplate;

  beforeEach(() => {
    db = createTestDb();
    deps = createDeps(db);
    template = loadTemplate();

    // 預建 5 個 verified skills
    for (const name of SKILL_NAMES) {
      createVerifiedSkill(deps.skillRegistry, name);
    }
  });

  // ── Test 1: 播種成功回傳所有 ID ──────────────────────────

  it('seeds successfully and returns all entity IDs', () => {
    const result = seedMarketWorld(db, template, deps, 'test-seeder');

    expect(result.village_id).toMatch(/^village-/);
    expect(result.constitution_id).toMatch(/^const-/);
    expect(result.chief_ids).toHaveLength(5);
    expect(result.skill_ids).toHaveLength(5);
    expect(result.zone_ids).toHaveLength(4);

    for (const id of result.chief_ids) {
      expect(id).toMatch(/^chief-/);
    }
    for (const id of result.zone_ids) {
      expect(id).toMatch(/^zone-/);
    }
  });

  // ── Test 2: WorldState 有 5 chiefs ───────────────────────

  it('WorldState contains 5 chiefs', () => {
    const result = seedMarketWorld(db, template, deps, 'test-seeder');
    const state = assembleWorldState(db, result.village_id);

    expect(state.chiefs).toHaveLength(5);
  });

  // ── Test 3: WorldState 有 active constitution ────────────

  it('WorldState has active constitution', () => {
    const result = seedMarketWorld(db, template, deps, 'test-seeder');
    const state = assembleWorldState(db, result.village_id);

    expect(state.constitution).not.toBeNull();
    expect(state.constitution?.status).toBe('active');
  });

  // ── Test 4: WorldState 有 5+ skills ──────────────────────

  it('WorldState has 5+ skills', () => {
    const result = seedMarketWorld(db, template, deps, 'test-seeder');
    const state = assembleWorldState(db, result.village_id);

    expect(state.skills.length).toBeGreaterThanOrEqual(5);
  });

  // ── Test 5: Chief names 正確 ─────────────────────────────

  it('chief names match expected set', () => {
    const result = seedMarketWorld(db, template, deps, 'test-seeder');
    const state = assembleWorldState(db, result.village_id);
    const names = state.chiefs.map((c) => c.name).sort();

    expect(names).toEqual([...CHIEF_NAMES].sort());
  });

  // ── Test 6: Constitution rules 包含關鍵詞 ────────────────

  it('constitution rules mention key governance terms', () => {
    const result = seedMarketWorld(db, template, deps, 'test-seeder');
    const state = assembleWorldState(db, result.village_id);
    const constitution = state.constitution;
    expect(constitution).not.toBeNull();

    const ruleTexts = constitution?.rules.map((r) => r.description) ?? [];
    const allText = ruleTexts.join(' ');

    // R-INFLATION: 提及 price 或 20%
    expect(allText).toMatch(/20%|price/i);

    // R-WORLDVIEW: 提及 world-view
    expect(allText).toMatch(/world-view/i);

    // R-NEWCOMER: 提及 new stall 或 newcomer
    expect(allText).toMatch(/new stall|newcomer/i);
  });

  // ── Test 7: MarketState 有 4 zones ───────────────────────

  it('MarketState has 4 zones with correct types', () => {
    const result = seedMarketWorld(db, template, deps, 'test-seeder');
    const market = assembleMarketState(db, result.village_id);

    expect(market.zones).toHaveLength(4);
    const types = market.zones.map((z) => z.type).sort();
    expect(types).toEqual(['entrance', 'main_street', 'side_alley', 'stage']);
  });

  // ── Test 8: Skill 不存在時回滾 ───────────────────────────

  it('rolls back on missing skill', () => {
    // 刪除一個 skill 使其不存在
    const growthSkill = deps.skillRegistry.resolveForIntent('growth-analysis', '');
    if (growthSkill) {
      db.prepare("UPDATE skills SET status = 'deprecated' WHERE id = ?").run(growthSkill.id);
    }

    expect(() => seedMarketWorld(db, template, deps, 'test-seeder')).toThrow(
      /growth-analysis.*not found/i,
    );

    // 確認 transaction 回滾：沒有 village 殘留
    const villages = db.prepare('SELECT COUNT(*) as cnt FROM villages').get() as { cnt: number };
    expect(villages.cnt).toBe(0);
  });

  // ── Test 9: 重複播種建立新 village ───────────────────────

  it('second seed creates a new village', () => {
    const r1 = seedMarketWorld(db, template, deps, 'test-seeder');
    const r2 = seedMarketWorld(db, template, deps, 'test-seeder');

    expect(r1.village_id).not.toBe(r2.village_id);
    const villages = db.prepare('SELECT COUNT(*) as cnt FROM villages').get() as { cnt: number };
    expect(villages.cnt).toBe(2);
  });

  // ── Test 10: Chief permissions 是 constitution 的子集 ────

  it('all chief permissions are within constitution allowed_permissions', () => {
    const result = seedMarketWorld(db, template, deps, 'test-seeder');
    const state = assembleWorldState(db, result.village_id);
    const allowed = new Set(state.constitution?.allowed_permissions ?? []);

    for (const chief of state.chiefs) {
      for (const perm of chief.permissions) {
        expect(allowed.has(perm)).toBe(true);
      }
    }
  });
});
