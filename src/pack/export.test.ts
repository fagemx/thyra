import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { initSchema } from '../db';
import { VillageManager } from '../village-manager';
import { ConstitutionStore } from '../constitution-store';
import { ChiefEngine } from '../chief-engine';
import { LawEngine } from '../law-engine';
import { SkillRegistry } from '../skill-registry';
import { VillagePackCompiler } from './compiler';
import type { VillagePack, CompileOptions } from './compiler';
import { exportVillage } from './export';
import type { ExportDeps } from './export';

// ── Helpers ──────────────────────────────────────────────────

function setup() {
  const db = new Database(':memory:');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  initSchema(db);

  const villageMgr = new VillageManager(db);
  const constitutionStore = new ConstitutionStore(db);
  const skillRegistry = new SkillRegistry(db);
  const chiefEngine = new ChiefEngine(db, constitutionStore, skillRegistry);
  const lawEngine = new LawEngine(db, constitutionStore, chiefEngine);

  const compiler = new VillagePackCompiler(
    villageMgr,
    constitutionStore,
    chiefEngine,
    lawEngine,
    skillRegistry,
  );

  const deps: ExportDeps = {
    villageMgr,
    constitutionStore,
    chiefEngine,
    lawEngine,
    skillRegistry,
  };

  return { db, villageMgr, constitutionStore, skillRegistry, chiefEngine, lawEngine, compiler, deps };
}

function createVerifiedSkill(
  registry: SkillRegistry,
  name: string,
  villageId?: string,
): string {
  const skill = registry.create(
    {
      name,
      village_id: villageId,
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

function makePack(overrides?: Partial<VillagePack>): VillagePack {
  return {
    version: '0.1',
    village: {
      name: 'test-village',
      description: 'A test village',
      target_repo: 'org/repo',
    },
    constitution: {
      allowed_permissions: ['dispatch_task', 'propose_law', 'enact_law_low'],
      budget: {
        max_cost_per_action: 10,
        max_cost_per_day: 100,
        max_cost_per_loop: 50,
      },
      rules: [
        { description: 'Must review code', enforcement: 'hard' as const },
      ],
    },
    chief: {
      name: 'test-chief',
      role: 'code reviewer',
      permissions: ['dispatch_task', 'propose_law', 'enact_law_low'],
      personality: {
        risk_tolerance: 'moderate',
        communication_style: 'concise',
        decision_speed: 'deliberate',
      },
      constraints: [
        { type: 'must' as const, description: 'always run tests' },
      ],
      skills: ['code-review'],
    },
    laws: [
      {
        category: 'testing',
        description: 'All PRs need tests',
        strategy: { min_coverage: 80 },
        evidence: { source: 'team', reasoning: 'quality' },
      },
    ],
    ...overrides,
  };
}

const defaultOpts: CompileOptions = {
  dry_run: false,
  source_path: '/tmp/test.yaml',
  compiled_by: 'village-pack:human',
};

// ── Tests ────────────────────────────────────────────────────

describe('exportVillage', () => {
  let env: ReturnType<typeof setup>;

  beforeEach(() => {
    env = setup();
  });

  it('should export a fully compiled village and match original input', () => {
    // Arrange: create skill and compile pack
    createVerifiedSkill(env.skillRegistry, 'code-review');
    const pack = makePack();
    const result = env.compiler.compile(pack, defaultOpts);
    expect(result.errors).toEqual([]);
    expect(result.completed_phases).toBe(5);

    const villageId = result.village.entity_id!;

    // Act: export
    const exported = exportVillage(villageId, env.deps);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;

    // Assert: structure matches original input
    expect(exported.data.pack_version).toBe('0.1');
    expect(exported.data.village.name).toBe(pack.village.name);
    expect(exported.data.village.description).toBe(pack.village.description);
    expect(exported.data.village.target_repo).toBe(pack.village.target_repo);

    // Constitution
    expect(exported.data.constitution.allowed_permissions).toEqual(
      expect.arrayContaining(pack.constitution.allowed_permissions),
    );
    expect(exported.data.constitution.budget).toEqual(pack.constitution.budget);
    expect(exported.data.constitution.rules.length).toBe(pack.constitution.rules.length);
    expect(exported.data.constitution.rules[0].description).toBe('Must review code');
    expect(exported.data.constitution.rules[0].enforcement).toBe('hard');

    // Chief
    expect(exported.data.chief.name).toBe(pack.chief.name);
    expect(exported.data.chief.role).toBe(pack.chief.role);
    expect(exported.data.chief.personality.risk_tolerance).toBe('moderate');
    expect(exported.data.chief.personality.communication_style).toBe('concise');
    expect(exported.data.chief.personality.decision_speed).toBe('deliberate');
    expect(exported.data.chief.constraints.length).toBe(1);
    expect(exported.data.chief.constraints[0]).toEqual({ type: 'must', description: 'always run tests' });
    expect(exported.data.chief.permissions).toEqual(
      expect.arrayContaining(pack.chief.permissions),
    );

    // Skills — should be name strings
    expect(exported.data.skills).toEqual(['code-review']);

    // Laws
    expect(exported.data.laws.length).toBe(1);
    expect(exported.data.laws[0].category).toBe('testing');
    expect(exported.data.laws[0].content.description).toBe('All PRs need tests');
    expect(exported.data.laws[0].content.strategy).toEqual({ min_coverage: 80 });
    expect(exported.data.laws[0].evidence.source).toBe('team');

    // No warnings
    expect(exported.warnings).toEqual([]);
  });

  it('should return error for non-existent village', () => {
    const result = exportVillage('village-nonexistent', env.deps);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VILLAGE_NOT_FOUND');
  });

  it('should export village with no constitution with warnings', () => {
    // Create village directly (no constitution)
    const village = env.villageMgr.create(
      { name: 'bare-village', description: 'no constitution', target_repo: 'org/bare', metadata: {} },
      'test',
    );

    const result = exportVillage(village.id, env.deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.village.name).toBe('bare-village');
    expect(result.data.constitution.rules).toEqual([]);
    expect(result.data.constitution.allowed_permissions).toEqual([]);
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings.some((w) => w.section === 'constitution')).toBe(true);
  });

  it('should export village with no chief with warnings', () => {
    // Create village + constitution but no chief
    const village = env.villageMgr.create(
      { name: 'no-chief', description: 'has constitution', target_repo: 'org/nc', metadata: {} },
      'test',
    );
    env.constitutionStore.create(village.id, {
      rules: [{ description: 'Rule 1', enforcement: 'soft' as const, scope: ['*'] }],
      allowed_permissions: ['dispatch_task'],
      budget_limits: { max_cost_per_action: 5, max_cost_per_day: 50, max_cost_per_loop: 25 },
    }, 'test');

    const result = exportVillage(village.id, env.deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.village.name).toBe('no-chief');
    expect(result.data.constitution.rules.length).toBe(1);
    expect(result.data.chief.name).toBe('');
    expect(result.data.skills).toEqual([]);
    expect(result.warnings.some((w) => w.section === 'chief')).toBe(true);
  });

  it('should produce idempotent round-trip: apply → export → apply = all skip', () => {
    // Step 1: Create skill and apply pack
    createVerifiedSkill(env.skillRegistry, 'code-review');
    const pack = makePack();
    const firstResult = env.compiler.compile(pack, defaultOpts);
    expect(firstResult.errors).toEqual([]);
    expect(firstResult.completed_phases).toBe(5);

    const villageId = firstResult.village.entity_id!;

    // Step 2: Export
    const exported = exportVillage(villageId, env.deps);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;

    // Step 3: Convert exported data back to compiler's VillagePack format and re-apply
    const recompilePack: VillagePack = {
      version: '0.1',
      village: {
        name: exported.data.village.name,
        description: exported.data.village.description,
        target_repo: exported.data.village.target_repo,
      },
      constitution: {
        allowed_permissions: exported.data.constitution.allowed_permissions as VillagePack['constitution']['allowed_permissions'],
        budget: exported.data.constitution.budget,
        rules: exported.data.constitution.rules,
      },
      chief: {
        name: exported.data.chief.name,
        role: exported.data.chief.role,
        permissions: exported.data.chief.permissions as VillagePack['chief']['permissions'],
        personality: exported.data.chief.personality as VillagePack['chief']['personality'],
        constraints: exported.data.chief.constraints as VillagePack['chief']['constraints'],
        skills: exported.data.skills,
      },
      laws: exported.data.laws.map((l) => ({
        category: l.category,
        description: l.content.description,
        strategy: l.content.strategy,
        evidence: l.evidence,
      })),
    };

    const secondResult = env.compiler.compile(recompilePack, defaultOpts);

    // All phases should be 'skip' — idempotent
    expect(secondResult.errors).toEqual([]);
    expect(secondResult.completed_phases).toBe(5);
    expect(secondResult.village.action).toBe('skip');
    expect(secondResult.constitution.action).toBe('skip');
    expect(secondResult.chief.action).toBe('skip');
    for (const entry of secondResult.laws.entries) {
      expect(entry.action).toBe('skip');
    }
  });

  it('should handle village with multiple laws', () => {
    createVerifiedSkill(env.skillRegistry, 'code-review');
    const pack = makePack({
      laws: [
        {
          category: 'testing',
          description: 'All PRs need tests',
          strategy: { min_coverage: 80 },
          evidence: { source: 'team', reasoning: 'quality' },
        },
        {
          category: 'review',
          description: 'All code must be reviewed',
          strategy: { min_reviewers: 1 },
          evidence: { source: 'policy', reasoning: 'accountability' },
        },
      ],
    });

    const compiled = env.compiler.compile(pack, defaultOpts);
    expect(compiled.errors).toEqual([]);

    const villageId = compiled.village.entity_id!;
    const exported = exportVillage(villageId, env.deps);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;

    expect(exported.data.laws.length).toBe(2);
    const categories = exported.data.laws.map((l) => l.category).sort();
    expect(categories).toEqual(['review', 'testing']);
  });

  it('should export skills as name strings, not binding objects', () => {
    createVerifiedSkill(env.skillRegistry, 'code-review');
    createVerifiedSkill(env.skillRegistry, 'test-runner');

    const pack = makePack({
      chief: {
        name: 'multi-skill-chief',
        role: 'reviewer',
        permissions: ['dispatch_task', 'propose_law', 'enact_law_low'],
        personality: {
          risk_tolerance: 'moderate',
          communication_style: 'concise',
          decision_speed: 'deliberate',
        },
        constraints: [],
        skills: ['code-review', 'test-runner'],
      },
    });

    const compiled = env.compiler.compile(pack, defaultOpts);
    expect(compiled.errors).toEqual([]);

    const villageId = compiled.village.entity_id!;
    const exported = exportVillage(villageId, env.deps);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;

    // Skills should be string[] not SkillBinding[]
    expect(exported.data.skills).toEqual(expect.arrayContaining(['code-review', 'test-runner']));
    expect(exported.data.skills.length).toBe(2);
    // Verify they are strings
    for (const s of exported.data.skills) {
      expect(typeof s).toBe('string');
    }
  });
});
