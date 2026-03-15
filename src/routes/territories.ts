import { Hono } from 'hono';
import type { TerritoryCoordinator } from '../territory';
import {
  CreateTerritoryInput,
  CreateAgreementInput,
  ShareSkillInput,
  ApproveAgreementInput,
  CreateTerritoryPolicyInput,
  TerritoryAuditQueryInput,
  AddVillageInput,
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

  // Territory policies
  app.post('/api/territories/:id/policies', async (c) => {
    const parsed = CreateTerritoryPolicyInput.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: parsed.error.message } }, 400);
    }
    try {
      const policy = coordinator.createPolicy(c.req.param('id'), parsed.data, 'human');
      return c.json({ ok: true, data: policy }, 201);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      const code = msg.includes('CONSTITUTION_FORBIDS') ? 'FORBIDDEN' : 'BAD_REQUEST';
      return c.json({ ok: false, error: { code, message: msg } }, code === 'FORBIDDEN' ? 403 : 400);
    }
  });

  app.get('/api/territories/:id/policies', (c) => {
    const status = c.req.query('status') || undefined;
    return c.json({ ok: true, data: coordinator.listPolicies(c.req.param('id'), { status }) });
  });

  app.post('/api/territory-policies/:id/revoke', (c) => {
    try {
      return c.json({ ok: true, data: coordinator.revokePolicy(c.req.param('id'), 'human') });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: msg } }, 400);
    }
  });

  // Add/remove village
  app.post('/api/territories/:id/villages', async (c) => {
    const parsed = AddVillageInput.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: parsed.error.message } }, 400);
    }
    try {
      const territory = coordinator.addVillage(c.req.param('id'), parsed.data, 'human');
      return c.json({ ok: true, data: territory });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      const code = msg.includes('CONSTITUTION_FORBIDS') ? 'FORBIDDEN' : 'BAD_REQUEST';
      return c.json({ ok: false, error: { code, message: msg } }, code === 'FORBIDDEN' ? 403 : 400);
    }
  });

  app.delete('/api/territories/:id/villages/:villageId', (c) => {
    try {
      const territory = coordinator.removeVillage(c.req.param('id'), c.req.param('villageId'), 'human');
      return c.json({ ok: true, data: territory });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: msg } }, 400);
    }
  });

  // Cross-village metrics
  app.get('/api/territories/:id/metrics', (c) => {
    try {
      return c.json({ ok: true, data: coordinator.getCrossVillageMetrics(c.req.param('id')) });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: msg } }, 400);
    }
  });

  // Cross-village audit
  app.get('/api/territories/:id/audit', (c) => {
    const parsed = TerritoryAuditQueryInput.safeParse({
      action: c.req.query('action') || undefined,
      actor: c.req.query('actor') || undefined,
      from: c.req.query('from') || undefined,
      to: c.req.query('to') || undefined,
      limit: c.req.query('limit') ? Number(c.req.query('limit')) : undefined,
      offset: c.req.query('offset') ? Number(c.req.query('offset')) : undefined,
    });
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: parsed.error.message } }, 400);
    }
    try {
      return c.json({ ok: true, data: coordinator.queryTerritoryAudit(c.req.param('id'), parsed.data) });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: msg } }, 400);
    }
  });

  // Shared precedents
  app.get('/api/territories/:id/precedents', (c) => {
    const category = c.req.query('category') || undefined;
    return c.json({ ok: true, data: coordinator.getSharedPrecedents(c.req.param('id'), { category }) });
  });

  return app;
}
