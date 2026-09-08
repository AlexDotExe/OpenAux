/**
 * Actor resolution seam.
 *
 * Patron auth transport is uniform across the API (CONTRACTS.md "Auth
 * transport"): every patron call — requests, votes, skip-votes, and now the
 * payment endpoints — carries `X-Session-Id`. `sessionActorResolver` looks that
 * session up through the narrow `SessionActorRepo` seam and yields both the
 * acting user and the venue context (so credit purchases no longer need a
 * client-supplied `X-Venue-Id` for the 70/30 split).
 *
 * `headerActorResolver` (`x-user-id` / `x-venue-id`) remains as a dev/back-compat
 * fallback: `createActorResolver` tries the session header first and falls back
 * to the legacy headers, so existing clients and integration suites keep working.
 * Either way, an unresolvable caller raises the same `unauthorized` error.
 */
import type { FastifyRequest } from 'fastify';
import { PaymentsError } from './errors.js';
import type { SessionActorRepo } from './session-repo.js';

export interface Actor {
  userId: string;
  /** Venue context for the purchase; may be null when derivable elsewhere. */
  venueId: string | null;
}

export type ActorResolver = (req: FastifyRequest) => Promise<Actor> | Actor;

export const SESSION_HEADER = 'x-session-id';
export const USER_HEADER = 'x-user-id';
export const VENUE_HEADER = 'x-venue-id';

function headerString(req: FastifyRequest, name: string): string | null {
  const v = req.headers[name];
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

const UNAUTHORIZED_MESSAGE =
  'Missing or invalid session (send X-Session-Id, or x-user-id for legacy clients).';

/** Legacy/dev resolver: `x-user-id` (required) + `x-venue-id` (optional) headers. */
export const headerActorResolver: ActorResolver = (req) => {
  const userId = headerString(req, USER_HEADER);
  if (!userId) {
    throw new PaymentsError('unauthorized', 'Missing x-user-id (no authenticated session).');
  }
  return { userId, venueId: headerString(req, VENUE_HEADER) };
};

/**
 * Preferred resolver: `X-Session-Id` -> { userId, venueId } via the session seam.
 * Throws `unauthorized` when the header is absent or the session is unknown /
 * inactive; compose it with `createActorResolver` to keep the legacy fallback.
 */
export function sessionActorResolver(sessions: SessionActorRepo): ActorResolver {
  return async (req) => {
    const sessionId = headerString(req, SESSION_HEADER);
    if (!sessionId) {
      throw new PaymentsError('unauthorized', UNAUTHORIZED_MESSAGE);
    }
    const actor = await sessions.findActorBySessionId(sessionId);
    if (!actor) {
      throw new PaymentsError('unauthorized', UNAUTHORIZED_MESSAGE);
    }
    return { userId: actor.userId, venueId: actor.venueId };
  };
}

/**
 * Uniform patron transport with back-compat: resolve from `X-Session-Id` when it
 * resolves, otherwise fall back to `x-user-id` / `x-venue-id`. Raises
 * `unauthorized` when neither works.
 */
export function createActorResolver(sessions: SessionActorRepo): ActorResolver {
  return async (req) => {
    const sessionId = headerString(req, SESSION_HEADER);
    if (sessionId) {
      const actor = await sessions.findActorBySessionId(sessionId);
      if (actor) return { userId: actor.userId, venueId: actor.venueId };
    }
    // Legacy transport (and stale/unknown session ids) fall through to headers.
    const userId = headerString(req, USER_HEADER);
    if (!userId) {
      throw new PaymentsError('unauthorized', UNAUTHORIZED_MESSAGE);
    }
    return { userId, venueId: headerString(req, VENUE_HEADER) };
  };
}

/** Idempotency key from the standard `Idempotency-Key` header. */
export function idempotencyKeyFrom(req: FastifyRequest): string | null {
  return headerString(req, 'idempotency-key');
}
