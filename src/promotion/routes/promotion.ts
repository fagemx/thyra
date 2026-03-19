import { Hono } from 'hono';
import { z } from 'zod';
import { buildPromotionHandoff } from '../handoff-builder';
import type { BuildHandoffInput } from '../handoff-builder';
import { evaluatePromotionChecklist } from '../checklist-evaluator';
import { packageHandoff } from '../handoff-packager';
import type { PackageResult } from '../handoff-packager';
import { PromotionHandoffSchema } from '../schemas/handoff';

// ---------------------------------------------------------------------------
// Input schemas for route validation
// ---------------------------------------------------------------------------

const EvaluateChecklistInput = z.object({
  targetLayer: z.enum(['project-plan', 'thyra-runtime']),
  context: z.record(z.boolean()),
});

const CreateHandoffInput = PromotionHandoffSchema.omit({ id: true, createdAt: true });

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function promotionRoutes(): Hono {
  const app = new Hono();
  const store = new Map<string, PackageResult>();

  // POST /api/promotion/checklists — evaluate promotion readiness
  app.post('/api/promotion/checklists', async (c) => {
    const parsed = EvaluateChecklistInput.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json(
        { ok: false, error: { code: 'VALIDATION', message: parsed.error.message } },
        400,
      );
    }

    const { targetLayer, context } = parsed.data;

    if (targetLayer === 'project-plan') {
      const checklist = evaluatePromotionChecklist('project-plan', {
        coreTerminologyStable: Boolean(context['coreTerminologyStable']),
        canonicalFormExists: Boolean(context['canonicalFormExists']),
        sharedTypesClear: Boolean(context['sharedTypesClear']),
        canonicalSliceExists: Boolean(context['canonicalSliceExists']),
        demoPathRunnable: Boolean(context['demoPathRunnable']),
        moduleBoundariesClear: Boolean(context['moduleBoundariesClear']),
      });
      return c.json({ ok: true, data: checklist });
    }

    const checklist = evaluatePromotionChecklist('thyra-runtime', {
      worldFormSelected: Boolean(context['worldFormSelected']),
      minimumWorldHasShape: Boolean(context['minimumWorldHasShape']),
      closureTargetClear: Boolean(context['closureTargetClear']),
      changeJudgmentDefined: Boolean(context['changeJudgmentDefined']),
      runtimeConstraintsExplicit: Boolean(context['runtimeConstraintsExplicit']),
    });
    return c.json({ ok: true, data: checklist });
  });

  // POST /api/promotion/handoffs — create + package handoff
  app.post('/api/promotion/handoffs', async (c) => {
    const parsed = CreateHandoffInput.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json(
        { ok: false, error: { code: 'VALIDATION', message: parsed.error.message } },
        400,
      );
    }

    const input = parsed.data as BuildHandoffInput;
    const handoff = buildPromotionHandoff(input);
    const result = packageHandoff(handoff);
    store.set(handoff.id, result);
    return c.json({ ok: true, data: result }, 201);
  });

  // GET /api/promotion/handoffs — list all handoffs
  app.get('/api/promotion/handoffs', (c) => {
    const data = Array.from(store.values());
    return c.json({ ok: true, data });
  });

  // GET /api/promotion/handoffs/:id — retrieve handoff by ID
  app.get('/api/promotion/handoffs/:id', (c) => {
    const result = store.get(c.req.param('id'));
    if (!result) {
      return c.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Handoff not found' } },
        404,
      );
    }
    return c.json({ ok: true, data: result });
  });

  return app;
}
