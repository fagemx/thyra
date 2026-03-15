import { Hono } from 'hono';
import { BriefInput, AskInput, CommandInput } from '../schemas/governance';
import { generateBrief, answerQuestion, executeCommand } from '../village-governance';
import type { GovernanceDeps } from '../village-governance';

/**
 * Governance interaction panel routes
 * POST /api/villages/:id/brief — 取得村莊現況簡報
 * POST /api/villages/:id/ask   — 向村莊提問
 * POST /api/villages/:id/command — 下達指令（經 risk assessment）
 */
export function governanceRoutes(deps: GovernanceDeps): Hono {
  const app = new Hono();

  // POST /api/villages/:id/brief — 村莊簡報
  app.post('/api/villages/:id/brief', async (c) => {
    const body: unknown = await c.req.json().catch(() => ({}));
    const parsed = BriefInput.safeParse(body);
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: parsed.error.message } }, 400);
    }

    const villageId = c.req.param('id');
    try {
      const brief = generateBrief(deps, villageId, parsed.data);
      return c.json({ ok: true, data: brief });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      if (msg === 'Village not found') {
        return c.json({ ok: false, error: { code: 'NOT_FOUND', message: msg } }, 404);
      }
      return c.json({ ok: false, error: { code: 'INTERNAL_ERROR', message: msg } }, 500);
    }
  });

  // POST /api/villages/:id/ask — 提問
  app.post('/api/villages/:id/ask', async (c) => {
    const parsed = AskInput.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: parsed.error.message } }, 400);
    }

    const villageId = c.req.param('id');
    try {
      const answer = answerQuestion(deps, villageId, parsed.data);
      return c.json({ ok: true, data: answer });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      if (msg === 'Village not found') {
        return c.json({ ok: false, error: { code: 'NOT_FOUND', message: msg } }, 404);
      }
      return c.json({ ok: false, error: { code: 'INTERNAL_ERROR', message: msg } }, 500);
    }
  });

  // POST /api/villages/:id/command — 下達指令
  app.post('/api/villages/:id/command', async (c) => {
    const parsed = CommandInput.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: parsed.error.message } }, 400);
    }

    const villageId = c.req.param('id');
    try {
      const result = executeCommand(deps, villageId, parsed.data);
      return c.json({ ok: true, data: result });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      if (msg === 'Village not found') {
        return c.json({ ok: false, error: { code: 'NOT_FOUND', message: msg } }, 404);
      }
      return c.json({ ok: false, error: { code: 'INTERNAL_ERROR', message: msg } }, 500);
    }
  });

  return app;
}
