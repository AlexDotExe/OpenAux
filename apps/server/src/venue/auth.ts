/**
 * PROVISIONAL venue-admin auth guard.
 *
 * Neither SPEC.md nor CONTRACTS.md defines venue-operator auth yet (only
 * patron auth via /api/sessions/join). Per the WS4 task brief this is a
 * stub: a bearer token checked against an expected value, applied as a
 * preHandler on every venue admin route. Today the "db field" half of
 * "token from env/db field" doesn't exist — db/schema.sql has no
 * venues.admin_token column (that's a contract-layer change, out of scope
 * for apps/server/src/venue/) — so the default provider is env-only: a
 * single shared secret (VENUE_ADMIN_TOKEN) valid for every venue. Replace
 * with real per-venue operator accounts/roles once that's designed.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { VenueId } from '@openaux/shared';
import { errorResponse } from './errors.js';

export interface AdminTokenProvider {
  /** Returns the expected admin token for this venue, or null if none is configured. */
  getExpectedToken(venueId: VenueId): Promise<string | null>;
}

/** Default stub: one shared secret for every venue, read from env. */
export class EnvAdminTokenProvider implements AdminTokenProvider {
  constructor(private readonly envVar: string = 'VENUE_ADMIN_TOKEN') {}

  async getExpectedToken(_venueId: VenueId): Promise<string | null> {
    return process.env[this.envVar] ?? null;
  }
}

export function extractBearerToken(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return null;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match ? match[1]!.trim() : null;
}

function timingSafeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Verifies a bearer token may administer a venue. Injected from the composition
 * root (venue-auth's owner-session verifier, which also honors the legacy secret).
 */
export type VenueAdminVerify = (venueId: string, token: string | null) => Promise<boolean>;

/**
 * Builds a Fastify preHandler that rejects requests without a valid venue admin token.
 * When a `verify` function is injected it is authoritative (owner-session auth); the
 * `tokenProvider` shared-secret compare is the standalone fallback used when the guard
 * is built without the composition root (e.g. in WS4's own tests).
 */
export function createVenueAdminGuard(
  tokenProvider: AdminTokenProvider,
  verify?: VenueAdminVerify,
) {
  return async function venueAdminGuard(
    request: FastifyRequest<{ Params: { venueId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const venueId = request.params.venueId;
    const provided = extractBearerToken(request.headers.authorization);

    if (verify) {
      if (!(await verify(venueId, provided))) {
        await reply.code(401).send(errorResponse('unauthorized', 'venue admin token required'));
      }
      return;
    }

    const expected = await tokenProvider.getExpectedToken(venueId);
    if (!expected || !provided || !timingSafeEquals(provided, expected)) {
      await reply.code(401).send(errorResponse('unauthorized', 'venue admin token required'));
    }
  };
}
