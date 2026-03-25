import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, relative } from 'path';
// os import removed — tests now use cwd-relative temp dirs
import { createDb, initSchema } from '../db';
import { VillageManager } from '../village-manager';
import { SkillRegistry } from '../skill-registry';
import { skillRoutes, parseSkillMarkdown } from './skills';

const SKILL_DEF = {
  description: 'Review code',
  prompt_template: 'Review: {changes}',
  tools_required: ['gh'],
  constraints: ['cite file:line'],
};

function buildApp() {
  const db = createDb(':memory:');
  initSchema(db);
  const villageMgr = new VillageManager(db);
  const registry = new SkillRegistry(db);

  const app = new Hono();
  app.onError((err, c) => {
    return c.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: err.message } },
      500,
    );
  });
  app.route('', skillRoutes(registry));

  return { app, db, villageMgr, registry };
}

function jsonPatch(body: unknown): RequestInit {
  return {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

describe('GET /api/skills/by-name/:name/content', () => {
  let app: Hono;
  let registry: SkillRegistry;
  let villageMgr: VillageManager;

  beforeEach(() => {
    const built = buildApp();
    app = built.app;
    registry = built.registry;
    villageMgr = built.villageMgr;
  });

  it('returns content as JSON by default', async () => {
    registry.create({
      name: 'stall-ranking',
      definition: SKILL_DEF,
      content: '# Stall Ranking\n\nRank market stalls.',
    }, 'u');

    const res = await app.request('/api/skills/by-name/stall-ranking/content');
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; data: { content: string; name: string; version: number; scope_type: string } };
    expect(body.ok).toBe(true);
    expect(body.data.content).toBe('# Stall Ranking\n\nRank market stalls.');
    expect(body.data.name).toBe('stall-ranking');
    expect(body.data.version).toBe(1);
    expect(body.data.scope_type).toBe('global');
  });

  it('returns raw markdown with ?format=raw', async () => {
    registry.create({
      name: 'raw-skill',
      definition: SKILL_DEF,
      content: '# Raw Content',
    }, 'u');

    const res = await app.request('/api/skills/by-name/raw-skill/content?format=raw');
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe('# Raw Content');
  });

  it('returns 404 for nonexistent skill', async () => {
    const res = await app.request('/api/skills/by-name/nonexistent/content');
    expect(res.status).toBe(404);
    const body = await res.json() as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('returns 404 when skill exists but has no content', async () => {
    registry.create({ name: 'no-content', definition: SKILL_DEF }, 'u');

    const res = await app.request('/api/skills/by-name/no-content/content');
    expect(res.status).toBe(404);
    const body = await res.json() as { ok: boolean; error: { code: string } };
    expect(body.error.code).toBe('NO_CONTENT');
  });

  it('scope cascade: village → global with village_id', async () => {
    const village = villageMgr.create({ name: 'market', target_repo: 'r' }, 'u');
    registry.create({
      name: 'scoped-skill',
      definition: SKILL_DEF,
      content: '# Village version',
      scope_type: 'village',
      village_id: village.id,
    }, 'u');
    registry.create({
      name: 'scoped-skill',
      definition: SKILL_DEF,
      content: '# Global version',
      scope_type: 'global',
    }, 'u');

    // With village_id → village version
    const res1 = await app.request(`/api/skills/by-name/scoped-skill/content?village_id=${village.id}`);
    const body1 = await res1.json() as { ok: boolean; data: { content: string; scope_type: string } };
    expect(body1.data.content).toBe('# Village version');
    expect(body1.data.scope_type).toBe('village');

    // Without village_id → global version
    const res2 = await app.request('/api/skills/by-name/scoped-skill/content');
    const body2 = await res2.json() as { ok: boolean; data: { content: string; scope_type: string } };
    expect(body2.data.content).toBe('# Global version');
    expect(body2.data.scope_type).toBe('global');
  });
});

describe('PATCH /api/skills/:id/content', () => {
  let app: Hono;
  let registry: SkillRegistry;

  beforeEach(() => {
    const built = buildApp();
    app = built.app;
    registry = built.registry;
  });

  it('updates content in-place', async () => {
    const s = registry.create({
      name: 'editable',
      definition: SKILL_DEF,
      content: 'original',
    }, 'u');

    const res = await app.request(`/api/skills/${s.id}/content`, jsonPatch({ content: 'updated content' }));
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; data: { content: string; version: number; id: string } };
    expect(body.ok).toBe(true);
    expect(body.data.content).toBe('updated content');
    expect(body.data.version).toBe(1); // no version bump
    expect(body.data.id).toBe(s.id);
  });

  it('returns 404 for nonexistent skill', async () => {
    const res = await app.request('/api/skills/nonexistent/content', jsonPatch({ content: 'test' }));
    expect(res.status).toBe(404);
  });

  it('returns 400 for missing content', async () => {
    const s = registry.create({ name: 'validation-test', definition: SKILL_DEF }, 'u');
    const res = await app.request(`/api/skills/${s.id}/content`, jsonPatch({ content: '' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for non-string content', async () => {
    const s = registry.create({ name: 'type-test', definition: SKILL_DEF }, 'u');
    const res = await app.request(`/api/skills/${s.id}/content`, jsonPatch({ content: 123 }));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/skills with filters', () => {
  let app: Hono;
  let registry: SkillRegistry;
  let villageMgr: VillageManager;

  beforeEach(() => {
    const built = buildApp();
    app = built.app;
    registry = built.registry;
    villageMgr = built.villageMgr;
  });

  it('filters by tags', async () => {
    registry.create({ name: 'market-skill', definition: SKILL_DEF, tags: ['market', 'ranking'] }, 'u');
    registry.create({ name: 'review-skill', definition: SKILL_DEF, tags: ['review'] }, 'u');

    const res = await app.request('/api/skills?tags=market');
    const body = await res.json() as { ok: boolean; data: { name: string }[] };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe('market-skill');
  });

  it('filters by multiple tags (AND)', async () => {
    registry.create({ name: 'both', definition: SKILL_DEF, tags: ['market', 'ranking'] }, 'u');
    registry.create({ name: 'one', definition: SKILL_DEF, tags: ['market'] }, 'u');

    const res = await app.request('/api/skills?tags=market,ranking');
    const body = await res.json() as { ok: boolean; data: { name: string }[] };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe('both');
  });

  it('filters by search on name', async () => {
    registry.create({ name: 'stall-ranking', definition: SKILL_DEF }, 'u');
    registry.create({ name: 'code-review', definition: SKILL_DEF }, 'u');

    const res = await app.request('/api/skills?search=stall');
    const body = await res.json() as { ok: boolean; data: { name: string }[] };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe('stall-ranking');
  });

  it('filters by search on description', async () => {
    registry.create({ name: 'skill-a', definition: { ...SKILL_DEF, description: 'Ranks market stalls' } }, 'u');
    registry.create({ name: 'skill-b', definition: SKILL_DEF }, 'u');

    const res = await app.request('/api/skills?search=stalls');
    const body = await res.json() as { ok: boolean; data: { name: string }[] };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe('skill-a');
  });

  it('filters by village_id', async () => {
    const village = villageMgr.create({ name: 'v1', target_repo: 'r' }, 'u');
    registry.create({
      name: 'village-skill',
      definition: SKILL_DEF,
      scope_type: 'village',
      village_id: village.id,
    }, 'u');
    registry.create({ name: 'global-skill', definition: SKILL_DEF }, 'u');

    const res = await app.request(`/api/skills?village_id=${village.id}`);
    const body = await res.json() as { ok: boolean; data: { name: string }[] };
    // village_id filter returns village + global (NULL)
    expect(body.data).toHaveLength(2);
  });

  it('combines multiple filters', async () => {
    registry.create({
      name: 'target',
      definition: SKILL_DEF,
      tags: ['market'],
      source_type: 'user',
    }, 'u');
    registry.create({
      name: 'decoy',
      definition: SKILL_DEF,
      tags: ['market'],
      source_type: 'marketplace',
    }, 'u');

    const res = await app.request('/api/skills?tags=market&source_type=user');
    const body = await res.json() as { ok: boolean; data: { name: string }[] };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe('target');
  });
});

// --- parseSkillMarkdown 單元測試 ---

describe('parseSkillMarkdown', () => {
  it('parses frontmatter with name and description', () => {
    const raw = '---\nname: commit\ndescription: Complete pre-commit workflow\ncontext: fork\n---\n\n# Commit\n\nRun the full commit flow.';
    const result = parseSkillMarkdown(raw);
    expect(result.name).toBe('commit');
    expect(result.description).toBe('Complete pre-commit workflow');
    expect(result.meta.context).toBe('fork');
    expect(result.body).toContain('# Commit');
    expect(result.body).toContain('Run the full commit flow.');
  });

  it('falls back to heading for name when no frontmatter name', () => {
    const raw = '# Stall Ranking\n\nRank market stalls by revenue.';
    const result = parseSkillMarkdown(raw);
    expect(result.name).toBe('stall-ranking');
    expect(result.description).toBe('Rank market stalls by revenue.');
  });

  it('handles no frontmatter at all', () => {
    const raw = '# My Skill\n\nDo something useful with the codebase.';
    const result = parseSkillMarkdown(raw);
    expect(result.name).toBe('my-skill');
    expect(result.description).toBe('Do something useful with the codebase.');
    expect(result.meta).toEqual({});
    expect(result.body).toBe(raw.trim());
  });

  it('handles empty/malformed frontmatter gracefully', () => {
    const raw = '---\n\n---\n\nSome content here for the skill body.';
    const result = parseSkillMarkdown(raw);
    expect(result.name).toBeNull();
    expect(result.body).toBe('Some content here for the skill body.');
  });
});

// --- POST /api/skills/upload ---

function jsonPost(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

interface UploadResponse {
  ok: boolean;
  data?: { id: string; name: string; content: string; source_type: string; tags: string[]; scope_type: string; definition: { description: string; prompt_template: string } };
  error?: { code: string; message: string };
}

describe('POST /api/skills/upload', () => {
  let app: Hono;

  beforeEach(() => {
    const built = buildApp();
    app = built.app;
  });

  it('uploads valid SKILL.md with frontmatter', async () => {
    const md = '---\nname: commit\ndescription: Complete pre-commit workflow\n---\n\n# Commit\n\nRun the full pre-commit workflow including lint, build, and test.';
    const res = await app.request('/api/skills/upload', jsonPost({ content: md }));
    expect(res.status).toBe(201);
    const body = await res.json() as UploadResponse;
    expect(body.ok).toBe(true);
    expect(body.data?.name).toBe('commit');
    expect(body.data?.source_type).toBe('upload');
    expect(body.data?.definition.description).toBe('Complete pre-commit workflow');
    expect(body.data?.content).toBe(md);
  });

  it('uses name override over frontmatter', async () => {
    const md = '---\nname: old-name\ndescription: Some description\n---\n\n# Old Name\n\nThe body content for this skill is long enough.';
    const res = await app.request('/api/skills/upload', jsonPost({ content: md, name: 'new-name' }));
    expect(res.status).toBe(201);
    const body = await res.json() as UploadResponse;
    expect(body.data?.name).toBe('new-name');
  });

  it('stores tags and scope_type', async () => {
    const md = '---\nname: tagged-skill\ndescription: A tagged skill\n---\n\n# Tagged\n\nThis skill has tags and a custom scope type.';
    const res = await app.request('/api/skills/upload', jsonPost({
      content: md,
      tags: ['market', 'ranking'],
      scope_type: 'global',
    }));
    expect(res.status).toBe(201);
    const body = await res.json() as UploadResponse;
    expect(body.data?.tags).toEqual(['market', 'ranking']);
    expect(body.data?.scope_type).toBe('global');
  });

  it('infers name from heading when no frontmatter name', async () => {
    const md = '# Code Review\n\nPerform a thorough code review on the changes.';
    const res = await app.request('/api/skills/upload', jsonPost({ content: md }));
    expect(res.status).toBe(201);
    const body = await res.json() as UploadResponse;
    expect(body.data?.name).toBe('code-review');
  });

  it('returns 400 when no content provided', async () => {
    const res = await app.request('/api/skills/upload', jsonPost({}));
    expect(res.status).toBe(400);
    const body = await res.json() as UploadResponse;
    expect(body.error?.code).toBe('VALIDATION');
  });

  it('returns 409 for duplicate name', async () => {
    const md = '---\nname: duplicate\ndescription: First version\n---\n\n# Duplicate\n\nThis is the first version of the duplicate skill.';
    await app.request('/api/skills/upload', jsonPost({ content: md }));
    const res = await app.request('/api/skills/upload', jsonPost({ content: md }));
    expect(res.status).toBe(409);
    const body = await res.json() as UploadResponse;
    expect(body.error?.code).toBe('CONFLICT');
  });

  it('works without frontmatter (body = prompt_template)', async () => {
    const md = '# Simple Skill\n\nJust a simple skill without any frontmatter at all.';
    const res = await app.request('/api/skills/upload', jsonPost({ content: md }));
    expect(res.status).toBe(201);
    const body = await res.json() as UploadResponse;
    expect(body.data?.name).toBe('simple-skill');
    expect(body.data?.definition.prompt_template).toBe(md.trim());
  });

  it('returns 400 for body too short', async () => {
    const md = '---\nname: short\ndescription: Short\n---\n\nHi';
    const res = await app.request('/api/skills/upload', jsonPost({ content: md }));
    expect(res.status).toBe(400);
    const body = await res.json() as UploadResponse;
    expect(body.error?.message).toContain('too short');
  });
});

// --- POST /api/skills/import-directory ---

interface ImportResult {
  path: string;
  status: 'imported' | 'skipped' | 'error';
  skill_id?: string;
  reason?: string;
}

interface ImportResponse {
  ok: boolean;
  data?: { imported: number; skipped: number; errors: number; results: ImportResult[]; dry_run: boolean };
  error?: { code: string; message: string };
}

describe('POST /api/skills/import-directory', () => {
  let app: Hono;
  let registry: SkillRegistry;
  const cwdTmpDirs: string[] = [];

  /** 在 cwd 下建立暫存目錄，回傳相對路徑 */
  function makeCwdTmpDir(suffix: string): { abs: string; rel: string } {
    const abs = mkdtempSync(join(process.cwd(), `.tmp-test-${suffix}-`));
    cwdTmpDirs.push(abs);
    return { abs, rel: relative(process.cwd(), abs) };
  }

  beforeEach(() => {
    const built = buildApp();
    app = built.app;
    registry = built.registry;
  });

  afterEach(() => {
    for (const d of cwdTmpDirs) {
      try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    cwdTmpDirs.length = 0;
  });

  it('imports directory with 2 skills', async () => {
    const { abs, rel } = makeCwdTmpDir('import');
    mkdirSync(join(abs, 'commit'));
    writeFileSync(join(abs, 'commit', 'SKILL.md'), '---\nname: commit\ndescription: Commit workflow\n---\n\n# Commit\n\nRun the commit workflow.');
    mkdirSync(join(abs, 'review'));
    writeFileSync(join(abs, 'review', 'SKILL.md'), '---\nname: review\ndescription: Code review\n---\n\n# Review\n\nPerform code review.');

    const res = await app.request('/api/skills/import-directory', jsonPost({ directory: rel }));
    expect(res.status).toBe(200);
    const body = await res.json() as ImportResponse;
    expect(body.ok).toBe(true);
    expect(body.data?.imported).toBe(2);
    expect(body.data?.skipped).toBe(0);
    expect(body.data?.errors).toBe(0);
  });

  it('skips duplicates without error', async () => {
    const { abs, rel } = makeCwdTmpDir('dup');
    mkdirSync(join(abs, 'existing'));
    writeFileSync(join(abs, 'existing', 'SKILL.md'), '---\nname: existing-skill\ndescription: Already exists\n---\n\n# Existing\n\nThis skill already exists.');

    // Pre-create the skill
    registry.create({
      name: 'existing-skill',
      definition: { description: 'Already there', prompt_template: 'Template' },
    }, 'u');

    const res = await app.request('/api/skills/import-directory', jsonPost({ directory: rel }));
    expect(res.status).toBe(200);
    const body = await res.json() as ImportResponse;
    expect(body.data?.skipped).toBe(1);
    expect(body.data?.imported).toBe(0);
    expect(body.data?.results[0].status).toBe('skipped');
  });

  it('returns 400 for nonexistent directory', async () => {
    const res = await app.request('/api/skills/import-directory', jsonPost({ directory: 'nonexistent-path-xyz' }));
    expect(res.status).toBe(400);
    const body = await res.json() as ImportResponse;
    expect(body.error?.code).toBe('VALIDATION');
  });

  it('returns 400 for path traversal with ..', async () => {
    const res = await app.request('/api/skills/import-directory', jsonPost({ directory: '../../../etc' }));
    expect(res.status).toBe(400);
    const body = await res.json() as ImportResponse;
    expect(body.error?.message).toContain('traversal');
  });

  it('returns 400 for absolute path (Unix-style)', async () => {
    const res = await app.request('/api/skills/import-directory', jsonPost({ directory: '/etc/passwd' }));
    expect(res.status).toBe(400);
    const body = await res.json() as ImportResponse;
    expect(body.error?.code).toBe('VALIDATION');
    expect(body.error?.message).toContain('Absolute');
  });

  it('returns 400 for absolute path (Windows-style)', async () => {
    const res = await app.request('/api/skills/import-directory', jsonPost({ directory: 'C:\\Windows\\System32' }));
    expect(res.status).toBe(400);
    const body = await res.json() as ImportResponse;
    expect(body.error?.code).toBe('VALIDATION');
    expect(body.error?.message).toContain('Absolute');
  });

  it('dry_run reports without creating skills', async () => {
    const { abs, rel } = makeCwdTmpDir('dry');
    mkdirSync(join(abs, 'dry-skill'));
    writeFileSync(join(abs, 'dry-skill', 'SKILL.md'), '---\nname: dry-test\ndescription: Dry run test\n---\n\n# Dry\n\nDry run skill content.');

    const res = await app.request('/api/skills/import-directory', jsonPost({ directory: rel, dry_run: true }));
    expect(res.status).toBe(200);
    const body = await res.json() as ImportResponse;
    expect(body.data?.imported).toBe(1);
    expect(body.data?.dry_run).toBe(true);

    // Verify no skill was actually created
    const skills = registry.list({ name: 'dry-test' });
    expect(skills).toHaveLength(0);
  });

  it('returns 200 with 0 imported for empty directory', async () => {
    const { rel } = makeCwdTmpDir('empty');
    const res = await app.request('/api/skills/import-directory', jsonPost({ directory: rel }));
    expect(res.status).toBe(200);
    const body = await res.json() as ImportResponse;
    expect(body.data?.imported).toBe(0);
  });
});
