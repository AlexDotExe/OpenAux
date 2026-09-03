/**
 * antispam — see ownership map in CLAUDE.md before editing (WS6).
 *
 * Exports for other workstreams:
 *   - `checkRequestCooldown` / `checkSessionExpiry` (cooldown.ts) — pure
 *     decision functions from Session fields, for WS1's request/session code.
 *   - `checkVoteAllowed` (vote-rate-limit.ts) — for WS3's vote endpoint.
 *   - `createFrictionProvider` (friction.ts) — for WS3's scoring/ranking loop;
 *     returns `{ artistRepeatPenalty, spamPenalty }` per queue item via
 *     `getFriction(item, now)`.
 *   - `startAntispamSweeper` (sweeper.ts) — call once at server startup with a
 *     `SessionRepository` (see `createPgSessionRepository` below).
 *   - `computeReputationScore` / `updateReputation` (reputation.ts) — reputation
 *     v1 formula + the recompute/persist/emit service (SPEC.md §5 V1).
 *   - `isWithinRadius` / `haversineDistanceM` (location.ts) — join-time geofence
 *     check for WS1's sessions/join (pure; wiring TODO in the report).
 *   - `computeGroupArrivalSpamSignal` / `detectArrivalClusters` (group-abuse.ts)
 *     — coarse arrival-time clustering signal for WS3's spam scoring term.
 */

import type { FrictionConfig, FrictionProvider } from './friction.js';
import { createFrictionProvider, DEFAULT_FRICTION_CONFIG } from './friction.js';
import {
  createPgRecentArtistsRepository,
  createPgVoteActivityRepository,
  type QueryablePool,
} from './pg-repositories.js';

export * from './cooldown.js';
export * from './friction.js';
export * from './vote-rate-limit.js';
export * from './sweeper.js';
export * from './reputation.js';
export * from './location.js';
export * from './group-abuse.js';
export * from './pg-repositories.js';

/** Convenience: a FrictionProvider wired straight to the shared pg pool. */
export function createPgFrictionProvider(
  pool: QueryablePool,
  config: FrictionConfig = DEFAULT_FRICTION_CONFIG,
): FrictionProvider {
  return createFrictionProvider(
    {
      recentArtistsRepository: createPgRecentArtistsRepository(pool),
      voteActivityRepository: createPgVoteActivityRepository(pool),
    },
    config,
  );
}
