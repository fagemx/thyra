import { Hono } from 'hono';
import type { TerritoryCoordinator } from '../territory';
import {
  CreateTerritoryInput,
  CreateAgreementInput,
  ApproveAgreementInput,
  ShareSkillInput,
} from '../schemas/territory';

export function territoryRoutes(coordinator: TerritoryCoordinator): Hono {
  const app = new Hono();

  app.post('/api/territories', async (c) => {
    const parsed = CreateTerritoryInput.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: parsed.error.message } }, 400);
    }
    try {
      const territory = coordinator.create(parsed.data, 'human');
      return c.json({ ok: true, data: territory }, 201);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      const code = msg.includes('CONSTITUTION_FORBIDS') ? 'FORBIDDEN' : 'BAD_REQUEST';
      return c.json({ ok: false, error: { code, message: msg } }, code === 'FORBIDDEN' ? 403 : 400);
    }
  });

  app.get('/api/territories', (c) => {
    const status = c.req.query('status') || undefined;
    return c.json({ ok: true, data: coordinator.list({ status }) });
  });

  app.get('/api/territories/:id', (c) => {
    const territory = coordinator.get(c.req.param('id'));
    if (!territory) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Territory not found' } }, 404);
    return c.json({ ok: true, data: territory });
  });

  app.post('/api/territories/:id/dissolve', (c) => {
    try {
      return c.json({ ok: true, data: coordinator.dissolve(c.req.param('id'), 'human') });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: msg } }, 400);
    }
  });

  // Agreements
  app.post('/api/territories/:id/agreements', async (c) => {
    const parsed = CreateAgreementInput.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: parsed.error.message } }, 400);
    }
    try {
      const agreement = coordinator.createAgreement(c.req.param('id'), parsed.data, 'human');
      return c.json({ ok: true, data: agreement }, 201);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: msg } }, 400);
    }
  });

  app.get('/api/territories/:id/agreements', (c) => {
    const status = c.req.query('status') || undefined;
    return c.json({ ok: true, data: coordinator.listAgreements(c.req.param('id'), { status }) });
  });

  app.post('/api/agreements/:id/approve', async (c) => {
    const parsed = ApproveAgreementInput.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: parsed.error.message } }, 400);
    }
    try {
      const agreement = coordinator.approveAgreement(c.req.param('id'), parsed.data.village_id, 'human');
      return c.json({ ok: true, data: agreement });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: msg } }, 400);
    }
  });

  // Skill sharing
  app.post('/api/territories/share-skill', async (c) => {
    const parsed = ShareSkillInput.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: parsed.error.message } }, 400);
    }
    try {
      const result = coordinator.shareSkill(parsed.data, 'human');
      return c.json({ ok: true, data: result });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: msg } }, 400);
    }
  });

  // Law templates
  app.get('/api/territories/:id/law-templates', (c) => {
    return c.json({ ok: true, data: coordinator.getSharedLawTemplates(c.req.param('id')) });
  });

  return app;
}
