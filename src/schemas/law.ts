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

export type ProposeLawInputRaw = z.input<typeof ProposeLawInput>;
export type ProposeLawInput = z.infer<typeof ProposeLawInput>;
export type EvaluateLawInput = z.infer<typeof EvaluateLawInput>;
