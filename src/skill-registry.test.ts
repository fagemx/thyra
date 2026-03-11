import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { createDb, initSchema } from './db';
import { VillageManager } from './village-manager';
import { SkillRegistry, validateSkillBindings, buildSkillPrompt } from './skill-registry';

const SKILL_DEF = {
  description: 'Review code',
  prompt_template: 'Review: {changes}',
  tools_required: ['gh'],
  constraints: ['cite file:line'],
};

describe('SkillRegistry', () => {
  let db: Database;
  let registry: SkillRegistry;
  let villageMgr: VillageManager;
  let villageId: string;

  beforeEach(() => {
    db = createDb(':memory:');
    initSchema(db);
    registry = new SkillRegistry(db);
    villageMgr = new VillageManager(db);
    villageId = villageMgr.create({ name: 'test', target_repo: 'r' }, 'u').id;
  });

  it('create → draft status', () => {
    const s = registry.create({ name: 'code-review', definition: SKILL_DEF }, 'u');
    expect(s.id).toMatch(/^skill-/);
    expect(s.status).toBe('draft');
    expect(s.version).toBe(1);
  });

  it('get → returns created skill', () => {
    const s = registry.create({ name: 'code-review', definition: SKILL_DEF }, 'u');
    expect(registry.get(s.id)?.name).toBe('code-review');
  });

  it('verify → status becomes verified', () => {
    const s = registry.create({ name: 'code-review', definition: SKILL_DEF }, 'u');
    const verified = registry.verify(s.id, 'admin');
    expect(verified.status).toBe('verified');
    expect(verified.verified_by).toBe('admin');
    expect(verified.verified_at).toBeTruthy();
  });

  it('update → version+1, new row, old preserved', () => {
    const s = registry.create({ name: 'code-review', definition: SKILL_DEF }, 'u');
    const s2 = registry.update(s.id, { definition: { description: 'Updated review' } }, 'u');
    expect(s2.version).toBe(2);
    expect(s2.status).toBe('draft');
    expect(s2.id).not.toBe(s.id);
    // Old version preserved
    expect(registry.get(s.id)?.version).toBe(1);
  });

  it('deprecate → status deprecated', () => {
    const s = registry.create({ name: 'code-review', definition: SKILL_DEF }, 'u');
    registry.verify(s.id, 'u');
    const dep = registry.deprecate(s.id, 'u');
    expect(dep.status).toBe('deprecated');
  });

  it('getAvailable → only verified + matching village/global', () => {
    const global = registry.create({ name: 'global-skill', definition: SKILL_DEF }, 'u');
    registry.verify(global.id, 'u');

    const local = registry.create({ name: 'local-skill', village_id: villageId, definition: SKILL_DEF }, 'u');
    registry.verify(local.id, 'u');

    const draft = registry.create({ name: 'draft-skill', definition: SKILL_DEF }, 'u');

    const other = villageMgr.create({ name: 'other', target_repo: 'r2' }, 'u');
    const otherSkill = registry.create({ name: 'other-skill', village_id: other.id, definition: SKILL_DEF }, 'u');
    registry.verify(otherSkill.id, 'u');

    const available = registry.getAvailable(villageId);
    const names = available.map((s) => s.name);
    expect(names).toContain('global-skill');
    expect(names).toContain('local-skill');
    expect(names).not.toContain('draft-skill');
    expect(names).not.toContain('other-skill');
  });

  it('list with filters', () => {
    registry.create({ name: 'a', definition: SKILL_DEF }, 'u');
    const b = registry.create({ name: 'b', definition: SKILL_DEF }, 'u');
    registry.verify(b.id, 'u');

    expect(registry.list({ status: 'draft' })).toHaveLength(1);
    expect(registry.list({ status: 'verified' })).toHaveLength(1);
    expect(registry.list({ name: 'a' })).toHaveLength(1);
  });

  it('name format validation', () => {
    expect(() => registry.create({ name: 'INVALID', definition: SKILL_DEF }, 'u')).toThrow();
    expect(() => registry.create({ name: 'has space', definition: SKILL_DEF }, 'u')).toThrow();
  });

  it('UNIQUE(name, version, village_id) enforced for same village', () => {
    registry.create({ name: 'dup', village_id: villageId, definition: SKILL_DEF }, 'u');
    expect(() => registry.create({ name: 'dup', village_id: villageId, definition: SKILL_DEF }, 'u')).toThrow();
  });
});

describe('validateSkillBindings', () => {
  let db: Database;
  let registry: SkillRegistry;
  let villageMgr: VillageManager;
  let villageId: string;

  beforeEach(() => {
    db = createDb(':memory:');
    initSchema(db);
    registry = new SkillRegistry(db);
    villageMgr = new VillageManager(db);
    villageId = villageMgr.create({ name: 'test', target_repo: 'r' }, 'u').id;
  });

  it('verified skill → valid', () => {
    const s = registry.create({ name: 'ok-skill', definition: { description: 'x', prompt_template: 'y', constraints: [] } }, 'u');
    registry.verify(s.id, 'u');
    const result = validateSkillBindings([{ skill_id: s.id, skill_version: 1 }], villageId, registry);
    expect(result.valid).toBe(true);
  });

  it('draft skill → invalid (THY-14)', () => {
    const s = registry.create({ name: 'draft-skill', definition: { description: 'x', prompt_template: 'y', constraints: [] } }, 'u');
    const result = validateSkillBindings([{ skill_id: s.id, skill_version: 1 }], villageId, registry);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('THY-14');
  });

  it('cross-village skill → invalid', () => {
    const other = villageMgr.create({ name: 'other', target_repo: 'r2' }, 'u');
    const s = registry.create({ name: 'cross-skill', village_id: other.id, definition: { description: 'x', prompt_template: 'y', constraints: [] } }, 'u');
    registry.verify(s.id, 'u');
    const result = validateSkillBindings([{ skill_id: s.id, skill_version: 1 }], villageId, registry);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('another village');
  });

  it('non-existent skill → invalid', () => {
    const result = validateSkillBindings([{ skill_id: 'xxx', skill_version: 1 }], villageId, registry);
    expect(result.valid).toBe(false);
  });
});

describe('buildSkillPrompt', () => {
  let db: Database;
  let registry: SkillRegistry;

  beforeEach(() => {
    db = createDb(':memory:');
    initSchema(db);
    registry = new SkillRegistry(db);
  });

  it('combines bound skills into prompt', () => {
    const s = registry.create({
      name: 'test-skill',
      definition: {
        description: 'Test',
        prompt_template: 'Do the thing',
        constraints: ['Be careful', 'Be thorough'],
      },
    }, 'u');
    registry.verify(s.id, 'u');

    const prompt = buildSkillPrompt([{ skill_id: s.id, skill_version: 1 }], registry);
    expect(prompt).toContain('## Skill: test-skill (v1)');
    expect(prompt).toContain('Do the thing');
    expect(prompt).toContain('- Be careful');
  });
});
