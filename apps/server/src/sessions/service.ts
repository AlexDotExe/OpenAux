/**
 * QR venue join (POST /api/sessions/join, CONTRACTS.md).
 *
 * Resolves venueQrToken -> venue, resolves/creates the user (guest by
 * default; authed via the injected AuthVerifier when authToken is present),
 * and creates or reuses the user's active session at that venue (unique per
 * user+venue — db/schema.sql `sessions_one_active_per_user_venue`).
 */
import type { JoinSessionRequest, Session, User, Venue } from '@openaux/shared';
import { isWithinRadius } from '../antispam/location.js';
import { AuthVerificationError, unimplementedAuthVerifier, type AuthVerifier } from './auth.js';
import { noopAnalyticsEmitter, type AnalyticsEventEmitter } from './analytics.js';
import type { SessionRepository } from './repository.js';

export interface JoinSessionDeps {
  repository: SessionRepository;
  authVerifier?: AuthVerifier;
  analytics?: AnalyticsEventEmitter;
  /** Injectable clock for deterministic tests; defaults to `() => new Date()`. */
  now?: () => Date;
}

export type JoinSessionResult =
  | { ok: true; session: Session; venue: Venue }
  | { ok: false; code: 'not_found' | 'unauthorized' | 'outside_geofence'; message: string };

function generateGuestDisplayName(): string {
  const suffix = Math.floor(1000 + Math.random() * 9000);
  return `Guest ${suffix}`;
}

export async function joinSession(
  request: JoinSessionRequest,
  deps: JoinSessionDeps,
): Promise<JoinSessionResult> {
  const { repository } = deps;
  const analytics = deps.analytics ?? noopAnalyticsEmitter;
  const authVerifier = deps.authVerifier ?? unimplementedAuthVerifier;
  const now = (deps.now ?? (() => new Date()))();

  const venue = await repository.findVenueByQrToken(request.venueQrToken);
  if (!venue) {
    return { ok: false, code: 'not_found', message: 'Invalid or unknown venue QR token' };
  }

  if (
    !isWithinRadius(venue, {
      latitude: request.latitude ?? null,
      longitude: request.longitude ?? null,
    })
  ) {
    return {
      ok: false,
      code: 'outside_geofence',
      message: 'You must be at the venue to join',
    };
  }

  let user: User;
  let isGuest: boolean;

  if (request.authToken) {
    try {
      const identity = await authVerifier.verify(request.authToken);
      user = await repository.findOrCreateAuthedUser(
        identity.provider,
        identity.subject,
        identity.displayName,
      );
      isGuest = false;
    } catch (err) {
      if (err instanceof AuthVerificationError) {
        return { ok: false, code: 'unauthorized', message: err.message };
      }
      throw err;
    }
  } else {
    user = await repository.createGuestUser(generateGuestDisplayName());
    isGuest = true;
  }

  const existing = await repository.findActiveSession(user.userId, venue.venueId);

  let session: Session;
  if (existing) {
    await repository.touchSession(existing.sessionId, now);
    session = { ...existing, lastActiveAt: now };
  } else {
    session = await repository.createSession(user.userId, venue.venueId, isGuest, {
      joinLatitude: request.latitude ?? null,
      joinLongitude: request.longitude ?? null,
    });
    analytics.emitAnalyticsEvent({
      eventType: 'user_session_started',
      actorUserId: user.userId,
      venueId: venue.venueId,
      queueItemId: null,
      metadata: { isGuest },
    });
  }

  return { ok: true, session, venue };
}
