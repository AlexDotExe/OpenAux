/**
 * Session lifecycle: 1-hour inactivity expiry (SPEC.md "Anti-spam" V0 list).
 *
 * isSessionExpired is a pure predicate — no I/O, no clock reads of its own —
 * so it's trivially unit-testable. sweepExpiredSessions is the orchestration
 * other workstreams call; WS6 owns scheduling it on an interval.
 */
import type { Session } from '@openaux/shared';
import type { AnalyticsEventEmitter } from './analytics.js';

/** 1 hour inactivity expiry (SPEC.md anti-spam, V0). */
export const SESSION_EXPIRY_MS = 60 * 60 * 1000;

/**
 * True if `session` has been inactive for at least `expiryMs`. Already
 * inactive sessions return false — they're not "newly expired," which
 * keeps repeated sweeps idempotent.
 */
export function isSessionExpired(
  session: Pick<Session, 'lastActiveAt' | 'isActive'>,
  now: Date,
  expiryMs: number = SESSION_EXPIRY_MS,
): boolean {
  if (!session.isActive) return false;
  return now.getTime() - session.lastActiveAt.getTime() >= expiryMs;
}

export interface SweepRepository {
  findActiveSessions(): Promise<Session[]>;
  expireSession(sessionId: string, expiredAt: Date): Promise<void>;
}

export interface SweepDeps {
  repository: SweepRepository;
  analytics?: AnalyticsEventEmitter;
  /** Called once per newly-expired session — realtime's sendSessionExpired plugs in here. */
  onSessionExpired?: (session: Session) => void;
  now?: Date;
  expiryMs?: number;
}

/**
 * Finds every active session that has been inactive for >= expiryMs, marks
 * it expired, emits `user_session_expired`, and notifies `onSessionExpired`
 * (e.g. to push a SessionExpiredEvent over the venue's WebSocket channel).
 * Returns the sessions that were just expired.
 */
export async function sweepExpiredSessions(deps: SweepDeps): Promise<Session[]> {
  const now = deps.now ?? new Date();
  const expiryMs = deps.expiryMs ?? SESSION_EXPIRY_MS;
  const active = await deps.repository.findActiveSessions();
  const expired = active.filter((session) => isSessionExpired(session, now, expiryMs));

  for (const session of expired) {
    await deps.repository.expireSession(session.sessionId, now);
    deps.analytics?.emitAnalyticsEvent({
      eventType: 'user_session_expired',
      actorUserId: session.userId,
      venueId: session.venueId,
      queueItemId: null,
      metadata: { sessionId: session.sessionId, isGuest: session.isGuest },
    });
    deps.onSessionExpired?.(session);
  }

  return expired;
}
