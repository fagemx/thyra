import { z } from 'zod';

export const ProposalBundleSchema = z.object({
  id: z.string(),
  worldId: z.string(),
  cycleId: z.string(),
  chiefId: z.string(),
  proposalIds: z.array(z.string()).min(1, 'ProposalBundle must contain at least one proposal'),
  strategySummary: z.string(),
  priority: z.enum(['normal', 'urgent', 'critical']),
  createdAt: z.string(),
  version: z.number().default(1),
});
export type ProposalBundle = z.infer<typeof ProposalBundleSchema>;
