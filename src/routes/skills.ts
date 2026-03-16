import { Hono } from 'hono';
import { CreateSkillInput, UpdateSkillInput } from '../schemas/skill';
import type { SkillRegistry } from '../skill-registry';

export function skillRoutes(registry: SkillRegistry): Hono {
  const app = new Hono();

  app.get('/api/skills', (c) => {
    const status = c.req.query('status') || undefined;
    const name = c.req.query('name') || undefined;
    const scope_type = c.req.query('scope_type') || undefined;
    const source_type = c.req.query('source_type') || undefined;
    const village_id = c.req.query('village_id') || undefined;
    const tagsParam = c.req.query('tags') || undefined;
    const tags = tagsParam ? tagsParam.split(',').map((t) => t.trim()).filter(Boolean) : undefined;
    const search = c.req.query('search') || undefined;
    return c.json({ ok: true, data: registry.list({ status, name, scope_type, source_type, village_id, tags, search }) });
  });

  app.post('/api/skills', async (c) => {
    const parsed = CreateSkillInput.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: parsed.error.message } }, 400);
    }
    return c.json({ ok: true, data: registry.create(parsed.data, 'human') }, 201);
  });

  // Content API — by name with scope cascade (must be before :id routes)
  app.get('/api/skills/by-name/:name/content', (c) => {
    const name = c.req.param('name');
    const villageId = c.req.query('village_id') || undefined;
    const format = c.req.query('format') || 'json';
    const skill = registry.getByNameWithScope(name, villageId);
    if (!skill) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Skill not found' } }, 404);
    if (skill.content === null) return c.json({ ok: false, error: { code: 'NO_CONTENT', message: 'Skill has no content' } }, 404);
    if (format === 'raw') {
      return c.text(skill.content);
    }
    return c.json({ ok: true, data: { content: skill.content, name: skill.name, version: skill.version, scope_type: skill.scope_type } });
  });

  app.get('/api/skills/:id', (c) => {
    const skill = registry.get(c.req.param('id'));
    if (!skill) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Skill not found' } }, 404);
    return c.json({ ok: true, data: skill });
  });

  app.patch('/api/skills/:id', async (c) => {
    const parsed = UpdateSkillInput.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: parsed.error.message } }, 400);
    }
    try {
      return c.json({ ok: true, data: registry.update(c.req.param('id'), parsed.data, 'human') });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: msg } }, 404);
    }
  });

  app.post('/api/skills/:id/verify', (c) => {
    try {
      return c.json({ ok: true, data: registry.verify(c.req.param('id'), 'human') });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: msg } }, 400);
    }
  });

  app.post('/api/skills/:id/deprecate', (c) => {
    try {
      return c.json({ ok: true, data: registry.deprecate(c.req.param('id'), 'human') });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: msg } }, 400);
    }
  });

  // Content update — in-place, no version bump
  app.patch('/api/skills/:id/content', async (c) => {
    const body: Record<string, unknown> = await c.req.json();
    if (typeof body.content !== 'string' || body.content.length === 0) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: 'content must be a non-empty string' } }, 400);
    }
    try {
      const skill = registry.updateContent(c.req.param('id'), body.content, 'human');
      return c.json({ ok: true, data: skill });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: msg } }, 404);
    }
  });

  app.get('/api/villages/:vid/skills', (c) => {
    return c.json({ ok: true, data: registry.getAvailable(c.req.param('vid')) });
  });

  return app;
}
