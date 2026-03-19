import { describe, it, expect } from 'vitest';
import {
  PromotionHandoffSchema,
  ProjectPlanPayloadSchema,
  ThyraRuntimePayloadSchema,
  StableObjectRefSchema,
  SourceLinkSchema,
} from './schemas/handoff';
import { buildPromotionHandoff } from './handoff-builder';
import type { BuildHandoffInput } from './handoff-builder';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const minimalStableObject = {
  kind: 'spec-file' as const,
  id: 'spec_abc123',
};

const minimalSourceLink = {
  kind: 'session' as const,
  ref: 'ds_abc123',
};

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

const thyraRuntimePayload = {
  worldSlug: 'midnight-market',
  worldForm: 'cycle-based',
  canonicalCyclePath: 'docs/spec/canonical-cycle.md',
  minimumWorld: {
    summary: 'A market with merchants trading goods',
    keyStateObjects: ['Stall', 'Merchant'],
    keyChangeKinds: ['open-stall', 'close-stall'],
    keyMetrics: ['revenue', 'occupancy'],
    keyRoles: ['merchant', 'market-master'],
  },
  closureTarget: {
    story: 'A merchant opens a stall and sells goods',
    mustDemonstrate: ['stall opens', 'good is sold'],
  },
  runtimeConstraints: {
    mustNotViolate: ['one stall per merchant'],
  },
};

function makeInput(payload: unknown): BuildHandoffInput {
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
    stableObjects: [minimalStableObject],
    constraints: ['must preserve merchant isolation'],
    sourceLinks: [minimalSourceLink],
    handoffPayload: payload as BuildHandoffInput['handoffPayload'],
  };
}

// ---------------------------------------------------------------------------
// Schema validation tests
// ---------------------------------------------------------------------------

describe('StableObjectRefSchema', () => {
  it('validates a minimal stable object', () => {
    const result = StableObjectRefSchema.safeParse(minimalStableObject);
    expect(result.success).toBe(true);
  });

  it('accepts optional path and note', () => {
    const result = StableObjectRefSchema.safeParse({
      ...minimalStableObject,
      path: 'docs/spec/overview.md',
      note: 'main overview',
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown kind', () => {
    const result = StableObjectRefSchema.safeParse({ kind: 'unknown', id: 'x' });
    expect(result.success).toBe(false);
  });

  it('accepts all 7 valid kinds', () => {
    const kinds = [
      'decision-session', 'card', 'spec-file', 'shared-types',
      'commit-memo', 'promotion-check', 'canonical-slice',
    ] as const;
    for (const kind of kinds) {
      const result = StableObjectRefSchema.safeParse({ kind, id: `${kind}_1` });
      expect(result.success).toBe(true);
    }
  });
});

describe('SourceLinkSchema', () => {
  it('validates a minimal source link', () => {
    const result = SourceLinkSchema.safeParse(minimalSourceLink);
    expect(result.success).toBe(true);
  });

  it('accepts optional whyRelevant', () => {
    const result = SourceLinkSchema.safeParse({
      ...minimalSourceLink,
      whyRelevant: 'defines core terminology',
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown kind', () => {
    const result = SourceLinkSchema.safeParse({ kind: 'unknown', ref: 'x' });
    expect(result.success).toBe(false);
  });

  it('accepts all 4 valid kinds', () => {
    const kinds = ['session', 'spec', 'event', 'precedent'] as const;
    for (const kind of kinds) {
      const result = SourceLinkSchema.safeParse({ kind, ref: `ref_${kind}` });
      expect(result.success).toBe(true);
    }
  });
});

describe('ProjectPlanPayloadSchema', () => {
  it('validates a complete project-plan payload', () => {
    const result = ProjectPlanPayloadSchema.safeParse(projectPlanPayload);
    expect(result.success).toBe(true);
  });

  it('rejects missing required fields', () => {
    const result = ProjectPlanPayloadSchema.safeParse({ projectName: 'x' });
    expect(result.success).toBe(false);
  });

  it('accepts optional sharedTypesPath and canonicalSliceSummary', () => {
    const result = ProjectPlanPayloadSchema.safeParse({
      ...projectPlanPayload,
      sharedTypesPath: 'src/shared/types.ts',
      canonicalSliceSummary: 'A merchant opens a stall',
      demoPathSummary: 'Full market cycle demo',
    });
    expect(result.success).toBe(true);
  });
});

describe('ThyraRuntimePayloadSchema', () => {
  it('validates a complete thyra-runtime payload', () => {
    const result = ThyraRuntimePayloadSchema.safeParse(thyraRuntimePayload);
    expect(result.success).toBe(true);
  });

  it('rejects missing required fields', () => {
    const result = ThyraRuntimePayloadSchema.safeParse({ worldSlug: 'x' });
    expect(result.success).toBe(false);
  });

  it('accepts optional runtime paths', () => {
    const result = ThyraRuntimePayloadSchema.safeParse({
      ...thyraRuntimePayload,
      sharedTypesPath: 'src/shared/types.ts',
      runtimeApiPath: 'src/api/routes.ts',
      judgmentRulesPath: 'src/rules/judgment.ts',
      metricsPath: 'src/metrics/index.ts',
    });
    expect(result.success).toBe(true);
  });

  it('accepts optional runtimeConstraints arrays', () => {
    const result = ThyraRuntimePayloadSchema.safeParse({
      ...thyraRuntimePayload,
      runtimeConstraints: {
        mustNotViolate: ['one stall per merchant'],
        requiresHumanApproval: ['delete merchant'],
        rollbackExpectations: ['stall state reverts on failure'],
      },
    });
    expect(result.success).toBe(true);
  });
});

describe('PromotionHandoffSchema', () => {
  it('validates handoff with ProjectPlanPayload', () => {
    const handoff = {
      id: 'handoff_aBcDeFgHiJkL',
      fromLayer: 'arch-spec',
      toLayer: 'project-plan',
      targetId: 'midnight-market',
      title: 'Promote to project-plan',
      summary: 'Ready',
      promotionVerdict: 'ready',
      whyNow: ['stable'],
      blockersResolved: [],
      knownGaps: [],
      stableObjects: [minimalStableObject],
      constraints: [],
      sourceLinks: [],
      handoffPayload: projectPlanPayload,
      createdAt: new Date().toISOString(),
    };
    const result = PromotionHandoffSchema.safeParse(handoff);
    expect(result.success).toBe(true);
  });

  it('validates handoff with ThyraRuntimePayload', () => {
    const handoff = {
      id: 'handoff_aBcDeFgHiJkL',
      fromLayer: 'arch-spec',
      toLayer: 'thyra-runtime',
      targetId: 'midnight-market',
      title: 'Promote to thyra-runtime',
      summary: 'Ready',
      promotionVerdict: 'ready',
      whyNow: ['world form selected'],
      blockersResolved: [],
      knownGaps: [],
      stableObjects: [minimalStableObject],
      constraints: [],
      sourceLinks: [],
      handoffPayload: thyraRuntimePayload,
      createdAt: new Date().toISOString(),
    };
    const result = PromotionHandoffSchema.safeParse(handoff);
    expect(result.success).toBe(true);
  });

  it('rejects empty stableObjects (CONTRACT PROMO-01)', () => {
    const handoff = {
      id: 'handoff_aBcDeFgHiJkL',
      fromLayer: 'arch-spec',
      toLayer: 'project-plan',
      targetId: 'x',
      title: 'x',
      summary: 'x',
      promotionVerdict: 'ready',
      whyNow: [],
      blockersResolved: [],
      knownGaps: [],
      stableObjects: [],
      constraints: [],
      sourceLinks: [],
      handoffPayload: projectPlanPayload,
      createdAt: new Date().toISOString(),
    };
    const result = PromotionHandoffSchema.safeParse(handoff);
    expect(result.success).toBe(false);
    if (!result.success) {
      const stableObjectsError = result.error.issues.find(
        (issue) => issue.path.includes('stableObjects')
      );
      expect(stableObjectsError).toBeDefined();
    }
  });

  it('rejects invalid fromLayer', () => {
    const handoff = {
      id: 'handoff_aBcDeFgHiJkL',
      fromLayer: 'invalid-layer',
      toLayer: 'project-plan',
      targetId: 'x',
      title: 'x',
      summary: 'x',
      promotionVerdict: 'ready',
      whyNow: [],
      blockersResolved: [],
      knownGaps: [],
      stableObjects: [minimalStableObject],
      constraints: [],
      sourceLinks: [],
      handoffPayload: projectPlanPayload,
      createdAt: new Date().toISOString(),
    };
    const result = PromotionHandoffSchema.safeParse(handoff);
    expect(result.success).toBe(false);
  });

  it('rejects invalid toLayer', () => {
    const handoff = {
      id: 'handoff_aBcDeFgHiJkL',
      fromLayer: 'arch-spec',
      toLayer: 'invalid-layer',
      targetId: 'x',
      title: 'x',
      summary: 'x',
      promotionVerdict: 'ready',
      whyNow: [],
      blockersResolved: [],
      knownGaps: [],
      stableObjects: [minimalStableObject],
      constraints: [],
      sourceLinks: [],
      handoffPayload: projectPlanPayload,
      createdAt: new Date().toISOString(),
    };
    const result = PromotionHandoffSchema.safeParse(handoff);
    expect(result.success).toBe(false);
  });

  it('accepts all three promotionVerdict values', () => {
    for (const verdict of ['ready', 'partial', 'not_ready'] as const) {
      const handoff = {
        id: 'handoff_aBcDeFgHiJkL',
        fromLayer: 'arch-spec',
        toLayer: 'project-plan',
        targetId: 'x',
        title: 'x',
        summary: 'x',
        promotionVerdict: verdict,
        whyNow: [],
        blockersResolved: [],
        knownGaps: [],
        stableObjects: [minimalStableObject],
        constraints: [],
        sourceLinks: [],
        handoffPayload: projectPlanPayload,
        createdAt: new Date().toISOString(),
      };
      const result = PromotionHandoffSchema.safeParse(handoff);
      expect(result.success).toBe(true);
    }
  });

  it('accepts multiple stableObjects', () => {
    const handoff = {
      id: 'handoff_aBcDeFgHiJkL',
      fromLayer: 'arch-spec',
      toLayer: 'project-plan',
      targetId: 'x',
      title: 'x',
      summary: 'x',
      promotionVerdict: 'ready',
      whyNow: [],
      blockersResolved: [],
      knownGaps: [],
      stableObjects: [
        minimalStableObject,
        { kind: 'card' as const, id: 'card_xyz', note: 'important card' },
      ],
      constraints: [],
      sourceLinks: [],
      handoffPayload: projectPlanPayload,
      createdAt: new Date().toISOString(),
    };
    const result = PromotionHandoffSchema.safeParse(handoff);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Builder tests
// ---------------------------------------------------------------------------

describe('buildPromotionHandoff', () => {
  it('produces a valid handoff with ProjectPlanPayload', () => {
    const input = makeInput(projectPlanPayload);
    const handoff = buildPromotionHandoff(input);

    expect(handoff.id).toMatch(/^handoff_/);
    expect(handoff.createdAt).toBeTruthy();
    expect(handoff.fromLayer).toBe('arch-spec');
    expect(handoff.toLayer).toBe('project-plan');

    // Round-trip validation
    const result = PromotionHandoffSchema.safeParse(handoff);
    expect(result.success).toBe(true);
  });

  it('produces a valid handoff with ThyraRuntimePayload', () => {
    const input = makeInput(thyraRuntimePayload);
    input.toLayer = 'thyra-runtime';
    const handoff = buildPromotionHandoff(input);

    expect(handoff.id).toMatch(/^handoff_/);
    const result = PromotionHandoffSchema.safeParse(handoff);
    expect(result.success).toBe(true);
  });

  it('generates unique IDs', () => {
    const input = makeInput(projectPlanPayload);
    const ids = new Set(
      Array.from({ length: 20 }, () => buildPromotionHandoff(input).id)
    );
    expect(ids.size).toBe(20);
  });

  it('throws on empty stableObjects (CONTRACT PROMO-01)', () => {
    const input = makeInput(projectPlanPayload);
    input.stableObjects = [];
    expect(() => buildPromotionHandoff(input)).toThrow();
  });

  it('sets createdAt to a valid ISO string', () => {
    const input = makeInput(projectPlanPayload);
    const handoff = buildPromotionHandoff(input);
    const parsed = new Date(handoff.createdAt);
    expect(parsed.toISOString()).toBe(handoff.createdAt);
  });

  it('preserves all input fields in output', () => {
    const input = makeInput(projectPlanPayload);
    const handoff = buildPromotionHandoff(input);

    expect(handoff.targetId).toBe(input.targetId);
    expect(handoff.title).toBe(input.title);
    expect(handoff.summary).toBe(input.summary);
    expect(handoff.promotionVerdict).toBe(input.promotionVerdict);
    expect(handoff.whyNow).toEqual(input.whyNow);
    expect(handoff.blockersResolved).toEqual(input.blockersResolved);
    expect(handoff.knownGaps).toEqual(input.knownGaps);
    expect(handoff.constraints).toEqual(input.constraints);
    expect(handoff.sourceLinks).toEqual(input.sourceLinks);
  });
});
