import { z } from 'zod';

export const ProposeLawInput = z.object({
  category: z.string().min(1),
  content: z.object({
    description: z.string().min(1),
    strategy: z.record(z.unknown()),
  }),
  evidence: z.object({
    source: z.string().min(1),
    reasoning: z.string().min(1),
    edda_refs: z.array(z.string()).optional(),
  }),
});

export const EvaluateLawInput = z.object({
  metrics: z.record(z.number()),
  verdict: z.enum(['effective', 'neutral', 'harmful']),
});

export const ProposeLawRequestInput = ProposeLawInput.extend({
  chief_id: z.string().min(1),
});

export const RollbackLawInput = z.object({
  reason: z.string().optional().default('Manual rollback'),
});

/** DB row schema — laws table */
export const LawRow = z.object({
  id: z.string(),
  village_id: z.string(),
  proposed_by: z.string(),
  approved_by: z.string().nullable(),
  version: z.number(),
  status: z.enum(['proposed', 'active', 'revoked', 'rolled_back', 'rejected']),
  category: z.string(),
  content: z.string(), // JSON string
  risk_level: z.enum(['low', 'medium', 'high']),
  evidence: z.string(), // JSON string
  effectiveness: z.string().nullable(), // JSON string
  created_at: z.string(),
  updated_at: z.string(),
}).passthrough();

export type ProposeLawInputRaw = z.input<typeof ProposeLawInput>;
export type ProposeLawInput = z.infer<typeof ProposeLawInput>;
export type EvaluateLawInput = z.infer<typeof EvaluateLawInput>;
export type ProposeLawRequestInput = z.infer<typeof ProposeLawRequestInput>;
export type RollbackLawInput = z.infer<typeof RollbackLawInput>;
