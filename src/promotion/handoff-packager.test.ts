import { describe, it, expect } from 'vitest';
import { generateLinksMarkdown, packageHandoff } from './handoff-packager';
import { buildPromotionHandoff } from './handoff-builder';
import type { BuildHandoffInput } from './handoff-builder';
import { evaluatePromotionChecklist } from './checklist-evaluator';
import { promotionRoutes } from './routes/promotion';
import type { PromotionHandoff } from './schemas/handoff';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const projectPlanPayload = {
  projectName: 'midnight-market',
  coreQuestion: 'How does the market cycle work?',
  canonicalFormSummary: 'Market has stalls, merchants, and goods',
  firstClassNouns: ['Stall', 'Merchant', 'Good'],
  stableNames: ['stall', 'merchant'],
  invariantRules: ['A merchant can only own one stall'],
  moduleBoundaries: ['market-core', 'merchant-engine'],
  requiredSpecs: [{ path: 'docs/spec/overview.md', role: 'overview' as const }],
  planningHints: {
    likelyTracks: ['T1-market-core'],
    obviousDependencies: ['merchant-engine depends on market-core'],
    suggestedValidationTargets: ['stall assignment'],
  },
};

function makeHandoffInput(): BuildHandoffInput {
  return {
    fromLayer: 'arch-spec',
    toLayer: 'project-plan',
    targetId: 'midnight-market',
    title: 'Promote Midnight Market to project-plan',
    summary: 'Core concepts stable, ready for track decomposition',
    promotionVerdict: 'ready',
    whyNow: ['canonical form stable', 'shared types defined'],
    blockersResolved: ['naming conflict resolved'],
    knownGaps: ['pricing model TBD'],
    stableObjects: [{ kind: 'spec-file' as const, id: 'spec_abc123', path: 'docs/spec/overview.md', note: 'main overview' }],
    constraints: ['must preserve merchant isolation'],
    sourceLinks: [{ kind: 'session' as const, ref: 'ds_abc123', whyRelevant: 'core terminology session' }],
    handoffPayload: projectPlanPayload,
  };
}

function makeHandoff(): PromotionHandoff {
  return buildPromotionHandoff(makeHandoffInput());
}

// ---------------------------------------------------------------------------
// generateLinksMarkdown
// ---------------------------------------------------------------------------

describe('generateLinksMarkdown', () => {
  it('includes title as heading', () => {
    const md = generateLinksMarkdown(makeHandoff());
    expect(md).toContain('# Promote Midnight Market to project-plan');
  });

  it('includes summary and verdict', () => {
    const md = generateLinksMarkdown(makeHandoff());
    expect(md).toContain('**Summary:** Core concepts stable');
    expect(md).toContain('**Verdict:** ready');
  });

  it('includes stable objects with kind, id, path, note', () => {
    const md = generateLinksMarkdown(makeHandoff());
    expect(md).toContain('## Stable Objects');
    expect(md).toContain('`spec-file`: spec_abc123');
    expect(md).toContain('(docs/spec/overview.md)');
    expect(md).toContain('main overview');
  });

  it('includes source links', () => {
    const md = generateLinksMarkdown(makeHandoff());
    expect(md).toContain('## Source Links');
    expect(md).toContain('`session`: ds_abc123');
    expect(md).toContain('core terminology session');
  });

  it('includes known gaps', () => {
    const md = generateLinksMarkdown(makeHandoff());
    expect(md).toContain('## Known Gaps');
    expect(md).toContain('pricing model TBD');
  });

  it('includes constraints', () => {
    const md = generateLinksMarkdown(makeHandoff());
    expect(md).toContain('## Constraints');
    expect(md).toContain('must preserve merchant isolation');
  });

  it('includes blockers resolved', () => {
    const md = generateLinksMarkdown(makeHandoff());
    expect(md).toContain('## Blockers Resolved');
    expect(md).toContain('naming conflict resolved');
  });
});

// ---------------------------------------------------------------------------
// packageHandoff
// ---------------------------------------------------------------------------

describe('packageHandoff', () => {
  it('returns correct shape with handoff and linksMarkdown', () => {
    const handoff = makeHandoff();
    const result = packageHandoff(handoff);
    expect(result.handoff).toBe(handoff);
    expect(result.checklist).toBeNull();
    expect(typeof result.linksMarkdown).toBe('string');
    expect(result.linksMarkdown.length).toBeGreaterThan(0);
  });

  it('includes checklist when provided', () => {
    const handoff = makeHandoff();
    const checklist = evaluatePromotionChecklist('project-plan', {
      coreTerminologyStable: true,
      canonicalFormExists: true,
      sharedTypesClear: true,
      canonicalSliceExists: true,
      demoPathRunnable: true,
      moduleBoundariesClear: true,
    });
    const result = packageHandoff(handoff, checklist);
    expect(result.checklist).toBe(checklist);
    expect(result.checklist?.verdict).toBe('ready');
  });

  it('sets checklist to null when not provided', () => {
    const result = packageHandoff(makeHandoff());
    expect(result.checklist).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Route integration tests
// ---------------------------------------------------------------------------

describe('promotionRoutes', () => {
  const app = promotionRoutes();

  // Helper to make JSON requests
  function req(method: string, path: string, body?: unknown) {
    const init: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) init.body = JSON.stringify(body);
    return app.request(path, init);
  }

  describe('POST /api/promotion/checklists', () => {
    it('evaluates project-plan checklist', async () => {
      const res = await req('POST', '/api/promotion/checklists', {
        targetLayer: 'project-plan',
        context: {
          coreTerminologyStable: true,
          canonicalFormExists: true,
          sharedTypesClear: true,
          canonicalSliceExists: true,
          demoPathRunnable: true,
          moduleBoundariesClear: true,
        },
      });
      expect(res.status).toBe(200);
      const json = await res.json() as { ok: boolean; data: { verdict: string; results: unknown[] } };
      expect(json.ok).toBe(true);
      expect(json.data.verdict).toBe('ready');
      expect(json.data.results).toHaveLength(6);
    });

    it('evaluates thyra-runtime checklist', async () => {
      const res = await req('POST', '/api/promotion/checklists', {
        targetLayer: 'thyra-runtime',
        context: {
          worldFormSelected: true,
          minimumWorldHasShape: false,
          closureTargetClear: true,
          changeJudgmentDefined: true,
          runtimeConstraintsExplicit: true,
        },
      });
      expect(res.status).toBe(200);
      const json = await res.json() as { ok: boolean; data: { verdict: string; results: unknown[] } };
      expect(json.ok).toBe(true);
      expect(json.data.verdict).toBe('partial');
      expect(json.data.results).toHaveLength(5);
    });

    it('returns 400 for invalid body', async () => {
      const res = await req('POST', '/api/promotion/checklists', { targetLayer: 'invalid' });
      expect(res.status).toBe(400);
      const json = await res.json() as { ok: boolean };
      expect(json.ok).toBe(false);
    });
  });

  describe('POST /api/promotion/handoffs', () => {
    it('creates and returns a packaged handoff', async () => {
      const input = makeHandoffInput();
      const res = await req('POST', '/api/promotion/handoffs', input);
      expect(res.status).toBe(201);
      const json = await res.json() as { ok: boolean; data: { handoff: { id: string }; linksMarkdown: string } };
      expect(json.ok).toBe(true);
      expect(json.data.handoff.id).toMatch(/^handoff_/);
      expect(json.data.linksMarkdown).toContain('Midnight Market');
    });

    it('returns 400 for empty stableObjects', async () => {
      const input = { ...makeHandoffInput(), stableObjects: [] };
      const res = await req('POST', '/api/promotion/handoffs', input);
      expect(res.status).toBe(400);
      const json = await res.json() as { ok: boolean };
      expect(json.ok).toBe(false);
    });
  });

  describe('GET /api/promotion/handoffs', () => {
    it('returns list of stored handoffs', async () => {
      // Use a fresh app for isolation
      const freshApp = promotionRoutes();
      const freshReq = (method: string, path: string, body?: unknown) => {
        const init: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
        if (body) init.body = JSON.stringify(body);
        return freshApp.request(path, init);
      };

      // Create one
      await freshReq('POST', '/api/promotion/handoffs', makeHandoffInput());

      const res = await freshReq('GET', '/api/promotion/handoffs');
      expect(res.status).toBe(200);
      const json = await res.json() as { ok: boolean; data: unknown[] };
      expect(json.ok).toBe(true);
      expect(json.data).toHaveLength(1);
    });
  });

  describe('GET /api/promotion/handoffs/:id', () => {
    it('returns stored handoff by ID', async () => {
      const freshApp = promotionRoutes();
      const freshReq = (method: string, path: string, body?: unknown) => {
        const init: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
        if (body) init.body = JSON.stringify(body);
        return freshApp.request(path, init);
      };

      const createRes = await freshReq('POST', '/api/promotion/handoffs', makeHandoffInput());
      const createJson = await createRes.json() as { data: { handoff: { id: string } } };
      const id = createJson.data.handoff.id;

      const res = await freshReq('GET', `/api/promotion/handoffs/${id}`);
      expect(res.status).toBe(200);
      const json = await res.json() as { ok: boolean; data: { handoff: { id: string } } };
      expect(json.ok).toBe(true);
      expect(json.data.handoff.id).toBe(id);
    });

    it('returns 404 for unknown ID', async () => {
      const res = await app.request('/api/promotion/handoffs/handoff_nonexistent');
      expect(res.status).toBe(404);
      const json = await res.json() as { ok: boolean };
      expect(json.ok).toBe(false);
    });
  });

  describe('full promotion flow', () => {
    it('evaluate checklist → build handoff → package → retrieve', async () => {
      const flowApp = promotionRoutes();
      const flowReq = (method: string, path: string, body?: unknown) => {
        const init: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
        if (body) init.body = JSON.stringify(body);
        return flowApp.request(path, init);
      };

      // 1. Evaluate checklist
      const checklistRes = await flowReq('POST', '/api/promotion/checklists', {
        targetLayer: 'project-plan',
        context: {
          coreTerminologyStable: true,
          canonicalFormExists: true,
          sharedTypesClear: true,
          canonicalSliceExists: true,
          demoPathRunnable: true,
          moduleBoundariesClear: true,
        },
      });
      const checklistJson = await checklistRes.json() as { data: { verdict: string } };
      expect(checklistJson.data.verdict).toBe('ready');

      // 2. Build handoff
      const createRes = await flowReq('POST', '/api/promotion/handoffs', makeHandoffInput());
      expect(createRes.status).toBe(201);
      const createJson = await createRes.json() as { data: { handoff: { id: string }; checklist: unknown; linksMarkdown: string } };
      const handoffId = createJson.data.handoff.id;
      expect(handoffId).toMatch(/^handoff_/);
      expect(createJson.data.linksMarkdown).toBeTruthy();

      // 3. Retrieve by ID
      const getRes = await flowReq('GET', `/api/promotion/handoffs/${handoffId}`);
      expect(getRes.status).toBe(200);
      const getJson = await getRes.json() as { ok: boolean; data: { handoff: { id: string } } };
      expect(getJson.ok).toBe(true);
      expect(getJson.data.handoff.id).toBe(handoffId);

      // 4. List all
      const listRes = await flowReq('GET', '/api/promotion/handoffs');
      const listJson = await listRes.json() as { data: unknown[] };
      expect(listJson.data.length).toBeGreaterThanOrEqual(1);
    });
  });
});
