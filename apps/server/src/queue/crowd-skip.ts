/**
 * Crowd-voted skip threshold (SPEC.md §5 V1: "Crowd-voted skip mechanism for now-playing
 * song"). Patrons vote to skip the currently-playing song; once enough of the room agrees
 * the DJ brain advances the queue.
 *
 * Threshold = max(CROWD_SKIP_MIN_VOTES, ceil(CROWD_SKIP_FRACTION · activeUsers)) — a simple
 * majority of the active room, with a floor so a near-empty room can't skip on one tap.
 *
 * Pure: caller passes the running tally and the active-user count. No I/O.
 */

import { CROWD_SKIP_FRACTION, CROWD_SKIP_MIN_VOTES } from './constants.js';

/** Skip-votes required to force the now-playing song out, given the active-user count. */
export function crowdSkipThreshold(activeUserCount: number): number {
  const byFraction = Math.ceil(CROWD_SKIP_FRACTION * Math.max(0, activeUserCount));
  return Math.max(CROWD_SKIP_MIN_VOTES, byFraction);
}

/** Has the crowd-skip tally reached the threshold for this room size? Pure. */
export function shouldCrowdSkip(crowdSkipVotes: number, activeUserCount: number): boolean {
  return crowdSkipVotes >= crowdSkipThreshold(activeUserCount);
}
