/**
 * Min-vote playability gate (SPEC.md §4 V1+ "hard guardrails" / §5 V1 anti-spam suite).
 *
 * Active only when a venue is on the V1 scoring model (`Venue.scoringModel === 'v1'`);
 * V0 has no gate at all. Pure — the caller supplies the venue's live active-user count
 * (WS1 `sessions.is_active`); this module holds no I/O.
 */

/** Live active-user count for a venue (`QueueRepository.getActiveUserCount`). */
export interface ActiveUserGate {
  activeUserCount: number;
}

/** Below this many active users, the gate is off entirely (SPEC.md D3). */
const MIN_ACTIVE_USERS_FOR_GATE = 10;
/** `up >= 6` once the gate is active. */
const MIN_UPVOTES = 6;
/** `up / (up + down) >= 0.60` once the gate is active. */
const MIN_POSITIVE_RATIO = 0.6;
/** 70%-of-active-users demand override — plays regardless of the ratio/count threshold. */
const ACTIVE_OVERRIDE_RATIO = 0.7;

export interface MinVoteGateInput {
  upvotesCount: number;
  downvotesCount: number;
  gate: ActiveUserGate;
}

/**
 * Minimum crowd approval to play (SPEC.md §4): once >=10 active users are in session,
 * an item needs `up >= 6 AND up/(up+down) >= 0.60`, unless upvotes alone already clear
 * 70% of active users (D3's crowd-override), which always plays. Below 10 actives the
 * gate is off and everything passes.
 */
export function passesMinVoteGate(input: MinVoteGateInput): boolean {
  const { activeUserCount } = input.gate;
  if (activeUserCount < MIN_ACTIVE_USERS_FOR_GATE) return true;
  if (input.upvotesCount >= activeUserCount * ACTIVE_OVERRIDE_RATIO) return true;

  const total = input.upvotesCount + input.downvotesCount;
  const ratio = total === 0 ? 0 : input.upvotesCount / total;
  return input.upvotesCount >= MIN_UPVOTES && ratio >= MIN_POSITIVE_RATIO;
}
