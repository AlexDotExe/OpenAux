/**
 * Pure suggestion-mode approval flow for
 * POST /api/venues/:venueId/approvals/:queueItemId (spec §1 layer 3:
 * playability). No I/O — the route handler loads/persists queue_items,
 * this function only decides the transition.
 */
import type { PlayabilityState, QueueItemStatus } from '@openaux/shared';

export interface ApprovalTargetState {
  status: QueueItemStatus;
  playabilityState: PlayabilityState;
}

export type ApprovalDecision = 'approve' | 'reject';

export type ApprovalOutcome =
  | { ok: true; playabilityState?: PlayabilityState; status?: QueueItemStatus }
  | { ok: false; reason: 'not_awaiting_approval' };

/**
 * approve: awaiting_approval -> playable.
 * reject: status -> blocked (playability_state is moot once blocked).
 * Only items currently awaiting_approval can be decided; already-decided
 * items are rejected rather than silently re-applied, so callers can return
 * a clear conflict instead of masking a stale request.
 */
export function applyApprovalDecision(
  current: ApprovalTargetState,
  decision: ApprovalDecision,
): ApprovalOutcome {
  if (current.playabilityState !== 'awaiting_approval') {
    return { ok: false, reason: 'not_awaiting_approval' };
  }
  if (decision === 'approve') {
    return { ok: true, playabilityState: 'playable' };
  }
  return { ok: true, status: 'blocked' };
}
