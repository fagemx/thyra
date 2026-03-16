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

    registry.create({ name: 'draft-skill', definition: SKILL_DEF }, 'u');

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

  describe('resolveForIntent', () => {
    it('returns verified skill matching name and village', () => {
      const s = registry.create({ name: 'code-review', village_id: villageId, definition: SKILL_DEF }, 'u');
      registry.verify(s.id, 'u');
      const result = registry.resolveForIntent('code-review', villageId);
      expect(result).not.toBeNull();
      expect(result!.name).toBe('code-review');
      expect(result!.status).toBe('verified');
    });

    it('returns global skill (village_id IS NULL)', () => {
      const s = registry.create({ name: 'global-tool', definition: SKILL_DEF }, 'u');
      registry.verify(s.id, 'u');
      const result = registry.resolveForIntent('global-tool', villageId);
      expect(result).not.toBeNull();
      expect(result!.village_id).toBeNull();
    });

    it('returns latest version when multiple verified exist', () => {
      const v1 = registry.create({ name: 'multi-ver', village_id: villageId, definition: SKILL_DEF }, 'u');
      registry.verify(v1.id, 'u');
      const v2 = registry.update(v1.id, { definition: { description: 'v2' } }, 'u');
      registry.verify(v2.id, 'u');
      const result = registry.resolveForIntent('multi-ver', villageId);
      expect(result).not.toBeNull();
      expect(result!.version).toBe(2);
    });

    it('returns null for non-existent skill name', () => {
      expect(registry.resolveForIntent('nonexistent', villageId)).toBeNull();
    });

    it('returns null for draft skills', () => {
      registry.create({ name: 'draft-only', village_id: villageId, definition: SKILL_DEF }, 'u');
      expect(registry.resolveForIntent('draft-only', villageId)).toBeNull();
    });

    it('returns null for deprecated skills', () => {
      const s = registry.create({ name: 'old-skill', village_id: villageId, definition: SKILL_DEF }, 'u');
      registry.verify(s.id, 'u');
      registry.deprecate(s.id, 'u');
      expect(registry.resolveForIntent('old-skill', villageId)).toBeNull();
    });

    it('does not return skill from another village', () => {
      const other = villageMgr.create({ name: 'other', target_repo: 'r2' }, 'u');
      const s = registry.create({ name: 'foreign-skill', village_id: other.id, definition: SKILL_DEF }, 'u');
      registry.verify(s.id, 'u');
      expect(registry.resolveForIntent('foreign-skill', villageId)).toBeNull();
    });

    it('returns shared skill via skill_shares', () => {
      const otherVillage = villageMgr.create({ name: 'provider', target_repo: 'r2' }, 'u');
      const s = registry.create({ name: 'shared-skill', village_id: otherVillage.id, definition: SKILL_DEF }, 'u');
      registry.verify(s.id, 'u');

      const now = new Date().toISOString();
      db.prepare(`INSERT INTO territories (id, name, village_ids, status, version, created_at, updated_at)
        VALUES (?, ?, ?, 'active', 1, ?, ?)`).run('t-1', 'shared-territory', JSON.stringify([villageId, otherVillage.id]), now, now);
      db.prepare(`INSERT INTO agreements (id, territory_id, type, parties, terms, approved_by, status, version, created_at, updated_at)
        VALUES (?, ?, 'resource_sharing', ?, '{}', '{}', 'active', 1, ?, ?)`).run('a-1', 't-1', JSON.stringify([villageId, otherVillage.id]), now, now);
      db.prepare(`INSERT INTO skill_shares (id, skill_id, from_village_id, to_village_id, territory_id, agreement_id, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`).run('ss-1', s.id, otherVillage.id, villageId, 't-1', 'a-1', now);

      const result = registry.resolveForIntent('shared-skill', villageId);
      expect(result).not.toBeNull();
      expect(result!.name).toBe('shared-skill');
    });
  });

  // New field tests (#219)
  describe('content, source, and scope fields', () => {
    it('create with content → round-trips through create/get', () => {
      const s = registry.create({
        name: 'with-content',
        definition: SKILL_DEF,
        content: '# My Skill\nDo things well.',
      }, 'u');
      expect(s.content).toBe('# My Skill\nDo things well.');
      const fetched = registry.get(s.id)!;
      expect(fetched.content).toBe('# My Skill\nDo things well.');
    });

    it('create with source fields → stored correctly', () => {
      const s = registry.create({
        name: 'sourced-skill',
        definition: SKILL_DEF,
        source_type: 'marketplace',
        source_origin: 'https://marketplace.example.com/skills/123',
      }, 'author-user');
      expect(s.source_type).toBe('marketplace');
      expect(s.source_origin).toBe('https://marketplace.example.com/skills/123');
      expect(s.source_author).toBe('author-user');
    });

    it('create with scope_type=village → requires village_id', () => {
      expect(() => registry.create({
        name: 'village-scoped',
        definition: SKILL_DEF,
        scope_type: 'village',
      }, 'u')).toThrow();
    });

    it('create with scope_type=village + village_id → works', () => {
      const s = registry.create({
        name: 'village-scoped',
        definition: SKILL_DEF,
        scope_type: 'village',
        village_id: villageId,
      }, 'u');
      expect(s.scope_type).toBe('village');
      expect(s.village_id).toBe(villageId);
    });

    it('create with scope_type=team → requires team_id', () => {
      expect(() => registry.create({
        name: 'team-scoped',
        definition: SKILL_DEF,
        scope_type: 'team',
      }, 'u')).toThrow();
    });

    it('create with scope_type=team + team_id → works', () => {
      const s = registry.create({
        name: 'team-scoped',
        definition: SKILL_DEF,
        scope_type: 'team',
        team_id: 'team-abc',
      }, 'u');
      expect(s.scope_type).toBe('team');
      expect(s.team_id).toBe('team-abc');
    });

    it('create with tags → JSON array round-trips', () => {
      const s = registry.create({
        name: 'tagged-skill',
        definition: SKILL_DEF,
        tags: ['review', 'code', 'testing'],
      }, 'u');
      expect(s.tags).toEqual(['review', 'code', 'testing']);
      const fetched = registry.get(s.id)!;
      expect(fetched.tags).toEqual(['review', 'code', 'testing']);
    });

    it('create with forked_from → stored correctly', () => {
      const original = registry.create({ name: 'original', definition: SKILL_DEF }, 'u');
      const fork = registry.create({
        name: 'forked-version',
        definition: SKILL_DEF,
        source_type: 'fork',
        forked_from: original.id,
      }, 'u');
      expect(fork.forked_from).toBe(original.id);
      expect(fork.source_type).toBe('fork');
    });

    it('update preserves source fields', () => {
      const s = registry.create({
        name: 'preserve-source',
        definition: SKILL_DEF,
        source_type: 'marketplace',
        source_origin: 'https://example.com',
      }, 'original-author');
      const s2 = registry.update(s.id, { definition: { description: 'Updated' } }, 'updater');
      expect(s2.source_type).toBe('marketplace');
      expect(s2.source_origin).toBe('https://example.com');
      expect(s2.source_author).toBe('original-author');
    });

    it('update resets used_count', () => {
      const s = registry.create({ name: 'usage-test', definition: SKILL_DEF }, 'u');
      registry.recordUsage(s.id);
      registry.recordUsage(s.id);
      const afterUsage = registry.get(s.id)!;
      expect(afterUsage.used_count).toBe(2);

      const s2 = registry.update(s.id, { definition: { description: 'v2' } }, 'u');
      expect(s2.used_count).toBe(0);
      expect(s2.last_used_at).toBeNull();
    });

    it('update allows content/tags override', () => {
      const s = registry.create({
        name: 'override-test',
        definition: SKILL_DEF,
        content: 'original content',
        tags: ['old-tag'],
      }, 'u');
      const s2 = registry.update(s.id, {
        content: 'new content',
        tags: ['new-tag', 'another'],
      }, 'u');
      expect(s2.content).toBe('new content');
      expect(s2.tags).toEqual(['new-tag', 'another']);
    });

    it('backward compat: create without new fields → defaults applied', () => {
      const s = registry.create({ name: 'old-style', definition: SKILL_DEF }, 'u');
      expect(s.content).toBeNull();
      expect(s.source_type).toBe('user');
      expect(s.source_origin).toBeNull();
      expect(s.source_author).toBe('u');
      expect(s.forked_from).toBeNull();
      expect(s.scope_type).toBe('global');
      expect(s.team_id).toBeNull();
      expect(s.tags).toEqual([]);
      expect(s.used_count).toBe(0);
      expect(s.last_used_at).toBeNull();
    });

    it('recordUsage increments count and sets last_used_at', () => {
      const s = registry.create({ name: 'usage-tracking', definition: SKILL_DEF }, 'u');
      expect(s.used_count).toBe(0);
      expect(s.last_used_at).toBeNull();

      registry.recordUsage(s.id);
      const after1 = registry.get(s.id)!;
      expect(after1.used_count).toBe(1);
      expect(after1.last_used_at).toBeTruthy();

      registry.recordUsage(s.id);
      const after2 = registry.get(s.id)!;
      expect(after2.used_count).toBe(2);
    });

    it('list filter by scope_type', () => {
      registry.create({ name: 'global-one', definition: SKILL_DEF }, 'u');
      registry.create({
        name: 'village-one',
        definition: SKILL_DEF,
        scope_type: 'village',
        village_id: villageId,
      }, 'u');

      const globalOnly = registry.list({ scope_type: 'global' });
      expect(globalOnly).toHaveLength(1);
      expect(globalOnly[0].name).toBe('global-one');

      const villageOnly = registry.list({ scope_type: 'village' });
      expect(villageOnly).toHaveLength(1);
      expect(villageOnly[0].name).toBe('village-one');
    });

    it('list filter by source_type', () => {
      registry.create({ name: 'user-skill', definition: SKILL_DEF }, 'u');
      registry.create({
        name: 'mp-skill',
        definition: SKILL_DEF,
        source_type: 'marketplace',
      }, 'u');

      const userOnly = registry.list({ source_type: 'user' });
      expect(userOnly).toHaveLength(1);
      expect(userOnly[0].name).toBe('user-skill');

      const mpOnly = registry.list({ source_type: 'marketplace' });
      expect(mpOnly).toHaveLength(1);
      expect(mpOnly[0].name).toBe('mp-skill');
    });
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
