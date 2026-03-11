import { Hono } from 'hono';
import type { RiskAssessor } from '../risk-assessor';
import type { ConstitutionStore } from '../constitution-store';

export function assessRoutes(assessor: RiskAssessor, constitutionStore: ConstitutionStore): Hono {
  const app = new Hono();

  app.post('/api/assess', async (c) => {
    const action = await c.req.json();
    const constitution = constitutionStore.getActive(action.village_id);
    const result = assessor.assess(action, {
      constitution,
      recent_rollbacks: [],
    });
    return c.json({ ok: true, data: result });
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
