import { z } from 'zod';

export const StableObjectRefSchema = z.object({
  kind: z.enum([
    'decision-session', 'card', 'spec-file', 'shared-types',
    'commit-memo', 'promotion-check', 'canonical-slice',
  ]),
  id: z.string(),
  path: z.string().optional(),
  note: z.string().optional(),
});
export type StableObjectRef = z.infer<typeof StableObjectRefSchema>;

export const SourceLinkSchema = z.object({
  kind: z.enum(['session', 'spec', 'event', 'precedent']),
  ref: z.string(),
  whyRelevant: z.string().optional(),
});
export type SourceLink = z.infer<typeof SourceLinkSchema>;

export const ProjectPlanPayloadSchema = z.object({
  projectName: z.string(),
  coreQuestion: z.string(),
  canonicalFormSummary: z.string(),
  firstClassNouns: z.array(z.string()),
  stableNames: z.array(z.string()),
  invariantRules: z.array(z.string()),
  moduleBoundaries: z.array(z.string()),
  sharedTypesPath: z.string().optional(),
  requiredSpecs: z.array(z.object({
    path: z.string(),
    role: z.enum(['overview', 'canonical-form', 'schema', 'rules', 'api', 'slice', 'demo-path', 'handoff']),
  })),
  canonicalSliceSummary: z.string().optional(),
  demoPathSummary: z.string().optional(),
  planningHints: z.object({
    likelyTracks: z.array(z.string()),
    obviousDependencies: z.array(z.string()),
    suggestedValidationTargets: z.array(z.string()),
  }),
});
export type ProjectPlanPayload = z.infer<typeof ProjectPlanPayloadSchema>;

export const ThyraRuntimePayloadSchema = z.object({
  worldSlug: z.string(),
  worldForm: z.string(),
  canonicalCyclePath: z.string(),
  sharedTypesPath: z.string().optional(),
  runtimeApiPath: z.string().optional(),
  judgmentRulesPath: z.string().optional(),
  metricsPath: z.string().optional(),
  minimumWorld: z.object({
    summary: z.string(),
    keyStateObjects: z.array(z.string()),
    keyChangeKinds: z.array(z.string()),
    keyMetrics: z.array(z.string()),
    keyRoles: z.array(z.string()),
  }),
  closureTarget: z.object({
    story: z.string(),
    mustDemonstrate: z.array(z.string()),
  }),
  runtimeConstraints: z.object({
    mustNotViolate: z.array(z.string()),
    requiresHumanApproval: z.array(z.string()).optional(),
    rollbackExpectations: z.array(z.string()).optional(),
  }),
});
export type ThyraRuntimePayload = z.infer<typeof ThyraRuntimePayloadSchema>;

export const PromotionHandoffSchema = z.object({
  id: z.string(),
  fromLayer: z.enum(['volva-working', 'arch-spec']),
  toLayer: z.enum(['project-plan', 'thyra-runtime']),
  targetId: z.string(),
  title: z.string(),
  summary: z.string(),
  promotionVerdict: z.enum(['ready', 'partial', 'not_ready']),
  whyNow: z.array(z.string()),
  blockersResolved: z.array(z.string()),
  knownGaps: z.array(z.string()),
  stableObjects: z.array(StableObjectRefSchema).min(1), // CONTRACT PROMO-01: non-empty
  constraints: z.array(z.string()),
  sourceLinks: z.array(SourceLinkSchema),
  handoffPayload: z.union([ProjectPlanPayloadSchema, ThyraRuntimePayloadSchema]),
  createdAt: z.string(),
});
export type PromotionHandoff = z.infer<typeof PromotionHandoffSchema>;
