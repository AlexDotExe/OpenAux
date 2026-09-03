/**
 * V1 playability gate (SPEC.md §1 layer 3 / §4 "Hard guardrails", decisions D3 / D12).
 *
 * The min-vote gate is ACTIVE ONLY when a venue session has ≥10 active users. At scale a
 * song must earn real crowd approval to play (up ≥ 6 AND positive ratio ≥ 0.60); below 10
 * actives the gate is OFF (an empty room shouldn't starve). An item backed by ≥70% of the
 * active users bypasses the gate entirely — overwhelming demand always plays. When the
 * top-ranked item fails the gate, the DJ brain falls back to the next playable item and
 * ultimately the venue playlist, so the room is never silent.
 *
 * Pure: callers pass vote counts and the active-user count. No I/O, no clock reads.
 * This layer is separate from V0 `isPlayable` (dj-brain.ts), which only checks status +
 * playability_state; the gate composes ON TOP of that basic check.
 */

import type { QueueItem, VenueControlMode } from '@openaux/shared';
import { isPlayable, type PlayabilityContext } from './dj-brain.js';
import {
  DEMAND_OVERRIDE_FRACTION,
  GATE_MIN_ACTIVE_USERS,
  MIN_VOTE_RATIO,
  MIN_VOTE_UPVOTES,
} from './constants.js';

export interface MinVoteInputs {
  upvotesCount: number;
  downvotesCount: number;
}

/** Is the min-vote gate active for a session of this size? (SPEC.md §4 / D3.) */
export function isMinVoteGateActive(activeUserCount: number): boolean {
  return activeUserCount >= GATE_MIN_ACTIVE_USERS;
}

/**
 * The min-vote gate itself: up ≥ 6 AND up/(up+down) ≥ 0.60 (SPEC.md §4). With zero votes
 * the ratio is treated as 0 (fails). Pure — does not check whether the gate is active.
 */
export function meetsMinVoteGate(votes: MinVoteInputs): boolean {
  if (votes.upvotesCount < MIN_VOTE_UPVOTES) return false;
  const total = votes.upvotesCount + votes.downvotesCount;
  if (total <= 0) return false;
  return votes.upvotesCount / total >= MIN_VOTE_RATIO;
}

/**
 * Demand override (SPEC.md §5 V1 / D3): an item supported by ≥70% of active users bypasses
 * the gate. `supporterCount` is the number of distinct users backing the item (upvoters —
 * the votes table enforces one vote per user; the requester counts too). Pure.
 */
export function hasDemandOverride(supporterCount: number, activeUserCount: number): boolean {
  if (activeUserCount <= 0) return false;
  return supporterCount >= DEMAND_OVERRIDE_FRACTION * activeUserCount;
}

export interface PlayabilityV1Inputs {
  upvotesCount: number;
  downvotesCount: number;
  /** Distinct users backing the item (upvoters + requester); used by the demand override. */
  supporterCount: number;
  activeUserCount: number;
}

/**
 * Does the min-vote gate permit this item to play? Returns true when the gate is inactive
 * (small room), when the item clears up≥6 / ratio≥0.60, or when demand overrides. Pure.
 * Composes on top of — but does not itself check — V0 status/playability_state.
 */
export function passesPlayabilityGate(inputs: PlayabilityV1Inputs): boolean {
  if (!isMinVoteGateActive(inputs.activeUserCount)) return true;
  if (hasDemandOverride(inputs.supporterCount, inputs.activeUserCount)) return true;
  return meetsMinVoteGate(inputs);
}

export interface PlayabilityV1Context extends PlayabilityContext {
  controlMode: VenueControlMode;
  activeUserCount: number;
}

/**
 * Full V1 playability predicate for a queue item: V0 basics (status + playability_state)
 * AND the min-vote gate. `supporterCount` defaults to the upvote count (each upvote is a
 * distinct user) but callers may pass a wider distinct-supporter measure. Pure.
 */
export function isPlayableV1(
  item: QueueItem,
  context: PlayabilityV1Context,
  supporterCount: number = item.upvotesCount,
): boolean {
  if (!isPlayable(item, context)) return false;
  return passesPlayabilityGate({
    upvotesCount: item.upvotesCount,
    downvotesCount: item.downvotesCount,
    supporterCount,
    activeUserCount: context.activeUserCount,
  });
}
