import { Hono } from 'hono';
import type { RiskAssessor } from '../risk-assessor';
import type { ConstitutionStore } from '../constitution-store';
import { AssessActionInput } from '../schemas/assess';

export function assessRoutes(assessor: RiskAssessor, constitutionStore: ConstitutionStore): Hono {
  const app = new Hono();

  app.post('/api/assess', async (c) => {
    const parsed = AssessActionInput.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }
    try {
      const action = parsed.data;
      const constitution = constitutionStore.getActive(action.village_id);
      const result = assessor.assess(action, {
        constitution,
        recent_rollbacks: [],
      });
      return c.json({ ok: true, data: result });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: msg } }, 400);
    }
  });

  app.get('/api/villages/:vid/budget', (c) => {
    const vid = c.req.param('vid');
    const constitution = constitutionStore.getActive(vid);
    const spentToday = assessor.getSpentToday(vid);
    return c.json({
      ok: true,
      data: {
        limits: constitution?.budget_limits ?? null,
        spent_today: spentToday,
        remaining_today: constitution ? constitution.budget_limits.max_cost_per_day - spentToday : null,
      },
    });
  });

  return app;
}
