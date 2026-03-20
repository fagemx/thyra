import { Hono } from 'hono';
import { z } from 'zod';
import type { Database } from '../../db';
import { appendAudit } from '../../db';
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
// DB helpers
// ---------------------------------------------------------------------------

function insertHandoff(db: Database, result: PackageResult): void {
  db.prepare(`
    INSERT INTO promotion_handoffs (id, handoff_json, checklist_json, links_markdown, version, created_at)
    VALUES (?, ?, ?, ?, 1, ?)
  `).run(
    result.handoff.id,
    JSON.stringify(result.handoff),
    result.checklist ? JSON.stringify(result.checklist) : null,
    result.linksMarkdown,
    result.handoff.createdAt,
  );
}

function rowToPackageResult(row: Record<string, unknown>): PackageResult {
  const result: PackageResult = {
    handoff: JSON.parse(row['handoff_json'] as string) as PackageResult['handoff'],
    checklist: row['checklist_json'] ? JSON.parse(row['checklist_json'] as string) as PackageResult['checklist'] : null,
    linksMarkdown: row['links_markdown'] as string,
  };
  return result;
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function promotionRoutes(db: Database): Hono {
  const app = new Hono();

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
        coreTerminologyStable: context['coreTerminologyStable'] ?? false,
        canonicalFormExists: context['canonicalFormExists'] ?? false,
        sharedTypesClear: context['sharedTypesClear'] ?? false,
        canonicalSliceExists: context['canonicalSliceExists'] ?? false,
        demoPathRunnable: context['demoPathRunnable'] ?? false,
        moduleBoundariesClear: context['moduleBoundariesClear'] ?? false,
      });
      return c.json({ ok: true, data: checklist });
    }

    const checklist = evaluatePromotionChecklist('thyra-runtime', {
      worldFormSelected: context['worldFormSelected'] ?? false,
      minimumWorldHasShape: context['minimumWorldHasShape'] ?? false,
      closureTargetClear: context['closureTargetClear'] ?? false,
      changeJudgmentDefined: context['changeJudgmentDefined'] ?? false,
      runtimeConstraintsExplicit: context['runtimeConstraintsExplicit'] ?? false,
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
    insertHandoff(db, result);
    appendAudit(db, 'promotion_handoff', handoff.id, 'create', result, 'system');
    return c.json({ ok: true, data: result }, 201);
  });

  // GET /api/promotion/handoffs — list all handoffs
  app.get('/api/promotion/handoffs', (c) => {
    const rows = db.prepare('SELECT * FROM promotion_handoffs ORDER BY created_at DESC').all() as Record<string, unknown>[];
    const data = rows.map(rowToPackageResult);
    return c.json({ ok: true, data });
  });

  // GET /api/promotion/handoffs/:id — retrieve handoff by ID
  app.get('/api/promotion/handoffs/:id', (c) => {
    const row = db.prepare('SELECT * FROM promotion_handoffs WHERE id = ?').get(c.req.param('id')) as Record<string, unknown> | null;
    if (!row) {
      return c.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Handoff not found' } },
        404,
      );
    }
    return c.json({ ok: true, data: rowToPackageResult(row) });
  });

  return app;
}
