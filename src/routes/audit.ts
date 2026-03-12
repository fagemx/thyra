import { Hono } from 'hono';
import { AuditQueryInput, VillageAuditQueryInput } from '../schemas/audit';
import type { AuditQuery } from '../audit-query';

export function auditRoutes(auditQuery: AuditQuery): Hono {
  const app = new Hono();

  // 通用 audit 查詢
  app.get('/api/audit', (c) => {
    const parsed = AuditQueryInput.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json(
        { ok: false, error: { code: 'VALIDATION', message: parsed.error.message } },
        400,
      );
    }
    return c.json({ ok: true, data: auditQuery.query(parsed.data) });
  });

  // Village 維度 audit 查詢
  app.get('/api/villages/:vid/audit', (c) => {
    const parsed = VillageAuditQueryInput.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json(
        { ok: false, error: { code: 'VALIDATION', message: parsed.error.message } },
        400,
      );
    }
    const vid = c.req.param('vid');
    return c.json({ ok: true, data: auditQuery.queryByVillage(vid, parsed.data) });
  });

  return app;
}
