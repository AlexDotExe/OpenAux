/**
 * The venue-admin verifier: turns a bearer token into an authorization decision.
 * Shared by every guard site (venue console routes, Spotify linking, console WS)
 * so one owner session token works everywhere.
 *
 * Accepts either:
 *   - a valid, unexpired venue-owner session token whose owner owns the venue, or
 *   - the legacy VENUE_ADMIN_TOKEN shared secret (migration fallback).
 */
import { hashToken, timingSafeStringEquals } from './crypto.js';
import type { VenueAuthRepository } from './repository.js';

export interface VenueAdminVerifier {
  /** Owner-level check: returns the ownerId for a valid session token, else null. */
  verifyOwner(token: string | null): Promise<string | null>;
  /** Venue-scoped check: is this token allowed to administer this venue? */
  verifyVenueAdmin(venueId: string, token: string | null): Promise<boolean>;
}

export interface VenueAdminVerifierDeps {
  repository: VenueAuthRepository;
  /** Legacy shared secret; defaults to process.env.VENUE_ADMIN_TOKEN. */
  legacySecret?: () => string | null;
  now?: () => Date;
}

export function createVenueAdminVerifier(deps: VenueAdminVerifierDeps): VenueAdminVerifier {
  const repo = deps.repository;
  const legacySecret = deps.legacySecret ?? (() => process.env.VENUE_ADMIN_TOKEN ?? null);
  const now = deps.now ?? (() => new Date());

  async function verifyOwner(token: string | null): Promise<string | null> {
    if (!token) return null;
    const session = await repo.findSession(hashToken(token));
    if (!session) return null;
    if (session.expiresAt.getTime() <= now().getTime()) return null;
    return session.venueOwnerId;
  }

  return {
    verifyOwner,
    async verifyVenueAdmin(venueId, token): Promise<boolean> {
      if (!token) return false;
      const secret = legacySecret();
      if (secret && timingSafeStringEquals(token, secret)) return true;
      const ownerId = await verifyOwner(token);
      if (!ownerId) return false;
      return repo.ownerOwnsVenue(ownerId, venueId);
    },
  };
}
