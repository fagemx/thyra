import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createDb, initSchema } from '../db';
import { VillageManager } from '../village-manager';
import { SkillRegistry } from '../skill-registry';
import { skillRoutes } from './skills';

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
