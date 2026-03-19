import type { CanonicalChangeProposal } from '../schemas/canonical-proposal';
import type { JudgeResult } from '../world/judge';

export interface PredictedEffect {
  metric: string;
  predicted: number;
  confidence: number;
}

export interface SimulationResult {
  proposalId: string;
  simulatedState: unknown;
  predictedEffects: PredictedEffect[];
  warnings: string[];
  wouldPass: boolean;
}

export function simulateProposal(
  proposal: CanonicalChangeProposal,
  judgeFn: (proposal: CanonicalChangeProposal) => JudgeResult,
): SimulationResult {
  const judgeResult = judgeFn(proposal);

  return {
    proposalId: proposal.id,
    simulatedState: null,
    predictedEffects: [],
    warnings: judgeResult.warnings,
    wouldPass: judgeResult.allowed,
  };
}
