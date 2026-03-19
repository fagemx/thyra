/**
 * ChangeProposal lifecycle state machine。
 *
 * 定義 15 種狀態之間的合法轉移，runtime 強制不允許跳階段。
 * 不修改現有 src/world/proposal.ts — 這是 canonical-cycle 的新增擴展。
 */
import type { ChangeProposalStatus } from '../schemas/canonical-proposal';

/**
 * Valid status transitions for the canonical proposal lifecycle.
 *
 * Lifecycle:
 *   draft → proposed → judged → verdict → applied → outcome_window_open → outcome_closed → archived
 *
 * Verdicts (from judged): approved, approved_with_constraints, rejected,
 *   simulation_required, escalated, deferred
 *
 * No skipping stages. Transitions are enforced at runtime.
 */
const VALID_TRANSITIONS: Record<ChangeProposalStatus, readonly ChangeProposalStatus[]> = {
  draft: ['proposed', 'cancelled'],
  proposed: ['judged'],
  judged: ['approved', 'approved_with_constraints', 'rejected', 'simulation_required', 'escalated', 'deferred'],
  approved: ['applied', 'cancelled'],
  approved_with_constraints: ['applied', 'cancelled'],
  rejected: ['archived'],
  simulation_required: ['judged', 'cancelled'],
  escalated: ['judged', 'cancelled'],
  deferred: ['proposed', 'cancelled'],
  applied: ['outcome_window_open', 'rolled_back'],
  cancelled: ['archived'],
  rolled_back: ['archived'],
  outcome_window_open: ['outcome_closed'],
  outcome_closed: ['archived'],
  archived: [],
};

/**
 * Validate and execute a status transition.
 * Throws if the transition is not allowed.
 */
export function transitionProposalStatus(
  current: ChangeProposalStatus,
  next: ChangeProposalStatus,
): ChangeProposalStatus {
  const allowed = VALID_TRANSITIONS[current];
  if (!allowed.includes(next)) {
    throw new Error(
      `Invalid proposal transition: ${current} → ${next}. Allowed: [${allowed.join(', ')}]`,
    );
  }
  return next;
}

/** Check if a transition is valid without throwing */
export function isValidTransition(
  current: ChangeProposalStatus,
  next: ChangeProposalStatus,
): boolean {
  return VALID_TRANSITIONS[current].includes(next);
}

/** Get all valid next statuses from a given status */
export function getValidNextStatuses(
  current: ChangeProposalStatus,
): readonly ChangeProposalStatus[] {
  return VALID_TRANSITIONS[current];
}
