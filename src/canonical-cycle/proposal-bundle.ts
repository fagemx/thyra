import type { ProposalBundle } from '../schemas/proposal-bundle';
import type { CanonicalChangeProposal } from '../schemas/canonical-proposal';
import { generateId, ID_PREFIXES } from '../cross-layer/id-generator';

export function createProposalBundle(
  worldId: string,
  cycleId: string,
  chiefId: string,
  proposals: CanonicalChangeProposal[],
  strategySummary: string,
  priority: 'normal' | 'urgent' | 'critical' = 'normal',
): ProposalBundle {
  if (proposals.length === 0) {
    throw new Error('ProposalBundle must contain at least one proposal');
  }
  return {
    id: generateId(ID_PREFIXES.bundle),
    worldId,
    cycleId,
    chiefId,
    proposalIds: proposals.map(p => p.id),
    strategySummary,
    priority,
    createdAt: new Date().toISOString(),
    version: 1,
  };
}
