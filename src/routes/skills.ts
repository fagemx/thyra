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
    return c.json({ ok: true, data: registry.list({ status, name, scope_type, source_type }) });
  });

  app.post('/api/skills', async (c) => {
    const parsed = CreateSkillInput.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: parsed.error.message } }, 400);
    }
    return c.json({ ok: true, data: registry.create(parsed.data, 'human') }, 201);
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

  app.get('/api/villages/:vid/skills', (c) => {
    return c.json({ ok: true, data: registry.getAvailable(c.req.param('vid')) });
  });

  return app;
}
