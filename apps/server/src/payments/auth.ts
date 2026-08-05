/**
 * Actor resolution seam.
 *
 * WS1 owns real session/auth (apps/server/src/sessions/). Until that lands,
 * settlement resolves the acting user + venue from request headers. The route
 * layer depends only on `ActorResolver`, so WS1 can swap in a token/session
 * implementation without touching payments code.
 *
 * TODO(ws1): replace `headerActorResolver` with a session-token resolver and
 * derive venue from the active session rather than a client-supplied header.
 */
import type { FastifyRequest } from 'fastify';
import { PaymentsError } from './errors.js';

export interface Actor {
  userId: string;
  /** Venue context for the purchase; may be null when derivable elsewhere. */
  venueId: string | null;
}

export type ActorResolver = (req: FastifyRequest) => Promise<Actor> | Actor;

function headerString(req: FastifyRequest, name: string): string | null {
  const v = req.headers[name];
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

/** Default resolver: `x-user-id` (required) + `x-venue-id` (optional) headers. */
export const headerActorResolver: ActorResolver = (req) => {
  const userId = headerString(req, 'x-user-id');
  if (!userId) {
    throw new PaymentsError('unauthorized', 'Missing x-user-id (no authenticated session).');
  }
  return { userId, venueId: headerString(req, 'x-venue-id') };
};

/** Idempotency key from the standard `Idempotency-Key` header. */
export function idempotencyKeyFrom(req: FastifyRequest): string | null {
  return headerString(req, 'idempotency-key');
}
