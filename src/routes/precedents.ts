/**
 * routes/precedents.ts — Precedent record API routes
 *
 * GET  /api/v1/worlds/:id/precedents — list precedents (spec §16.1)
 * GET  /api/v1/precedents/:id        — get precedent (spec §16.2)
 * POST /api/v1/precedents/search     — search related precedents (spec §16.3)
 *
 * CONTRACT: THY-11 — unified response envelope { ok, data/error }
 * CONTRACT: API-01 — THY-11 envelope on all responses
 * CONTRACT: API-02 — route paths match world-cycle-api.md
 * CONTRACT: PREC-01 — proposalId + outcomeReportId always present
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { Database } from '../db';

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const ListPrecedentsQuery = z.object({
  kind: z.string().optional(),
  targetPattern: z.string().optional(),
  verdict: z.enum(['beneficial', 'neutral', 'harmful', 'inconclusive']).optional(),
  contextTag: z.string().optional(),
});

const SearchPrecedentsInput = z.object({
  worldType: z.string().optional(),
  proposalKind: z.string().optional(),
  contextTags: z.array(z.string()).optional(),
});

// ---------------------------------------------------------------------------
// DB row type
// ---------------------------------------------------------------------------

interface PrecedentRow {
  id: string;
  world_id: string;
  world_type: string;
  proposal_id: string;
  outcome_report_id: string;
  change_kind: string;
  cycle_id: string;
  context: string;
  decision: string;
  outcome: string;
  recommendation: string;
  lessons_learned: string;
  context_tags: string;
  version: number;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Escape LIKE wildcards (% and _) so user input is treated literally */
function escapeLikePattern(s: string): string {
  return s.replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function rowToResponse(row: PrecedentRow): Record<string, unknown> {
  return {
    id: row.id,
    worldId: row.world_id,
    worldType: row.world_type,
    proposalId: row.proposal_id,
    outcomeReportId: row.outcome_report_id,
    changeKind: row.change_kind,
    cycleId: row.cycle_id,
    context: row.context,
    decision: row.decision,
    outcome: row.outcome,
    recommendation: row.recommendation,
    lessonsLearned: JSON.parse(row.lessons_learned) as unknown,
    contextTags: JSON.parse(row.context_tags) as unknown,
    version: row.version,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function precedentRoutes(db: Database): Hono {
  const app = new Hono();

  // -----------------------------------------------------------------------
  // §16.1 — List Precedents for a World
  // -----------------------------------------------------------------------
  app.get('/api/v1/worlds/:id/precedents', (c) => {
    const worldId = c.req.param('id');
    const queryParsed = ListPrecedentsQuery.safeParse({
      kind: c.req.query('kind'),
      targetPattern: c.req.query('targetPattern'),
      verdict: c.req.query('verdict'),
      contextTag: c.req.query('contextTag'),
    });

    if (!queryParsed.success) {
      return c.json(
        { ok: false, error: { code: 'VALIDATION', message: queryParsed.error.message } },
        400,
      );
    }

    const { kind, verdict, contextTag } = queryParsed.data;

    let sql = 'SELECT * FROM precedent_records WHERE world_id = ?';
    const params: string[] = [worldId];

    if (kind) {
      sql += ' AND change_kind = ?';
      params.push(kind);
    }
    if (verdict) {
      sql += ' AND outcome = ?';
      params.push(verdict);
    }
    if (contextTag) {
      sql += " AND context_tags LIKE ? ESCAPE '\\'";
      params.push(`%"${escapeLikePattern(contextTag)}"%`);
    }

    sql += ' ORDER BY created_at DESC';

    const rows = db.prepare(sql).all(...params) as PrecedentRow[];
    return c.json({ ok: true, data: rows.map(rowToResponse) });
  });

  // -----------------------------------------------------------------------
  // §16.2 — Get Precedent by ID
  // -----------------------------------------------------------------------
  app.get('/api/v1/precedents/:id', (c) => {
    const precedentId = c.req.param('id');
    const row = db.prepare('SELECT * FROM precedent_records WHERE id = ?').get(precedentId) as PrecedentRow | null;

    if (!row) {
      return c.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Precedent not found' } },
        404,
      );
    }

    return c.json({ ok: true, data: rowToResponse(row) });
  });

  // -----------------------------------------------------------------------
  // §16.3 — Search Related Precedents
  // -----------------------------------------------------------------------
  app.post('/api/v1/precedents/search', async (c) => {
    const body: unknown = await c.req.json().catch(() => ({}));
    const parsed = SearchPrecedentsInput.safeParse(body);

    if (!parsed.success) {
      return c.json(
        { ok: false, error: { code: 'VALIDATION', message: parsed.error.message } },
        400,
      );
    }

    const { worldType, proposalKind, contextTags } = parsed.data;

    let sql = 'SELECT * FROM precedent_records WHERE 1=1';
    const params: string[] = [];

    if (worldType) {
      sql += ' AND world_type = ?';
      params.push(worldType);
    }
    if (proposalKind) {
      sql += ' AND change_kind = ?';
      params.push(proposalKind);
    }
    if (contextTags && contextTags.length > 0) {
      // Match any of the provided tags
      const tagClauses = contextTags.map(() => "context_tags LIKE ? ESCAPE '\\'");
      sql += ` AND (${tagClauses.join(' OR ')})`;
      for (const tag of contextTags) {
        params.push(`%"${escapeLikePattern(tag)}"%`);
      }
    }

    sql += ' ORDER BY created_at DESC';

    const rows = db.prepare(sql).all(...params) as PrecedentRow[];
    return c.json({ ok: true, data: rows.map(rowToResponse) });
  });

  return app;
}
