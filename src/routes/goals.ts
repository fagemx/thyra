import { Hono } from 'hono';
import { CreateGoalInput, UpdateGoalInput, GoalLevelEnum, GoalStatusEnum } from '../schemas/goal';
import type { GoalStore } from '../goal-store';

export function goalRoutes(goalStore: GoalStore): Hono {
  const app = new Hono();

  // GET /api/villages/:id/goals — list goals
  app.get('/api/villages/:id/goals', (c) => {
    const villageId = c.req.param('id');
    const status = c.req.query('status');
    const level = c.req.query('level');
    const chiefId = c.req.query('chief_id');

    const parsedStatus = status ? GoalStatusEnum.safeParse(status) : undefined;
    const parsedLevel = level ? GoalLevelEnum.safeParse(level) : undefined;

    if (parsedStatus && !parsedStatus.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: 'Invalid status filter' } }, 400);
    }
    if (parsedLevel && !parsedLevel.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: 'Invalid level filter' } }, 400);
    }

    const goals = goalStore.list(villageId, {
      status: parsedStatus?.data,
      level: parsedLevel?.data,
      owner_chief_id: chiefId ?? undefined,
    });

    return c.json({ ok: true, data: goals });
  });

  // POST /api/villages/:id/goals — create goal
  app.post('/api/villages/:id/goals', async (c) => {
    const villageId = c.req.param('id');
    const body: Record<string, unknown> = await c.req.json();
    const input = { ...body, village_id: villageId };
    const parsed = CreateGoalInput.safeParse(input);
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: parsed.error.message } }, 400);
    }
    try {
      const goal = goalStore.create(villageId, parsed.data, 'human');
      return c.json({ ok: true, data: goal }, 201);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      if (msg.includes('NOT_FOUND') || msg.includes('CROSS_VILLAGE')) {
        return c.json({ ok: false, error: { code: 'VALIDATION', message: msg } }, 400);
      }
      throw e;
    }
  });

  // GET /api/goals/:id — get goal with ancestry
  app.get('/api/goals/:id', (c) => {
    const goalId = c.req.param('id');
    const goal = goalStore.get(goalId);
    if (!goal) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Goal not found' } }, 404);
    }
    const ancestry = goalStore.getAncestry(goalId);
    return c.json({ ok: true, data: { goal, ancestry } });
  });

  // PATCH /api/goals/:id — update goal
  app.patch('/api/goals/:id', async (c) => {
    const goalId = c.req.param('id');
    const parsed = UpdateGoalInput.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION', message: parsed.error.message } }, 400);
    }
    try {
      const updated = goalStore.update(goalId, parsed.data, 'human');
      return c.json({ ok: true, data: updated });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      if (msg === 'Goal not found') {
        return c.json({ ok: false, error: { code: 'NOT_FOUND', message: msg } }, 404);
      }
      throw e;
    }
  });

  // GET /api/chiefs/:id/goals — get chief's goal ancestry chain
  app.get('/api/chiefs/:id/goals', (c) => {
    const chiefId = c.req.param('id');
    const goalAncestry = goalStore.getChiefGoalAncestry(chiefId);
    return c.json({ ok: true, data: goalAncestry });
  });

  return app;
}
