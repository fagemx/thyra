import { Hono } from 'hono';
import { CreateChiefInput, UpdateChiefInput } from '../schemas/chief';
import type { ChiefEngine } from '../chief-engine';
import { buildChiefPrompt } from '../chief-engine';
import type { SkillRegistry } from '../skill-registry';

export function chiefRoutes(engine: ChiefEngine, skillRegistry: SkillRegistry): Hono {
  const app = new Hono();

  app.get('/api/villages/:vid/chiefs', (c) => {
    const status = c.req.query('status') || undefined;
    return c.json({ ok: true, data: engine.list(c.req.param('vid'), status ? { status } : undefined) });
  });

  app.post('/api/villages/:vid/chiefs', async (c) => {
    const parsed = CreateChiefInput.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: parsed.error.message } }, 400);
    }
    try {
      return c.json({ ok: true, data: engine.create(c.req.param('vid'), parsed.data, 'human') }, 201);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      const code = msg.includes('PERMISSION_EXCEEDS') ? 'PERMISSION_EXCEEDS_CONSTITUTION'
        : msg.includes('SKILL_NOT_VERIFIED') ? 'SKILL_NOT_VERIFIED'
        : 'BAD_REQUEST';
      return c.json({ ok: false, error: { code, message: msg } }, 400);
    }
  });

  app.get('/api/chiefs/:id', (c) => {
    const chief = engine.get(c.req.param('id'));
    if (!chief) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Chief not found' } }, 404);
    return c.json({ ok: true, data: chief });
  });

  app.patch('/api/chiefs/:id', async (c) => {
    const parsed = UpdateChiefInput.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: parsed.error.message } }, 400);
    }
    try {
      return c.json({ ok: true, data: engine.update(c.req.param('id'), parsed.data, 'human') });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: msg } }, 400);
    }
  });

  app.delete('/api/chiefs/:id', (c) => {
    try {
      engine.deactivate(c.req.param('id'), 'human');
      return c.json({ ok: true, data: null });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: msg } }, 404);
    }
  });

  app.get('/api/chiefs/:id/prompt', (c) => {
    const chief = engine.get(c.req.param('id'));
    if (!chief) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Chief not found' } }, 404);
    const prompt = buildChiefPrompt(chief, skillRegistry);
    return c.json({ ok: true, data: { prompt } });
  });

  return app;
}
