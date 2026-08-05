/**
 * Anti-spam cooldown + session-expiry decisions (SPEC.md §5 V0 Anti-spam).
 *
 * Pure functions only — no I/O, no clock reads. Callers (route handlers, the
 * sweeper job) pass in Session fields and `now`.
 */

/** 1 request / 2 min per user (SPEC.md V0 anti-spam). */
export const REQUEST_COOLDOWN_MS = 2 * 60 * 1000;

/** Session expires after 1 hour of inactivity (SPEC.md V0 anti-spam). */
export const SESSION_EXPIRY_MS = 60 * 60 * 1000;

export interface CooldownCheckFields {
  cooldownEndsAt: Date | null;
}

export interface CooldownDecision {
  allowed: boolean;
  cooldownEndsAt: Date | null;
  /** Milliseconds until the cooldown lifts; 0 when allowed. */
  retryAfterMs: number;
}

/** Is a new request allowed right now, given the session's current cooldown? */
export function checkRequestCooldown(session: CooldownCheckFields, now: Date): CooldownDecision {
  if (!session.cooldownEndsAt || session.cooldownEndsAt.getTime() <= now.getTime()) {
    return { allowed: true, cooldownEndsAt: session.cooldownEndsAt, retryAfterMs: 0 };
  }
  return {
    allowed: false,
    cooldownEndsAt: session.cooldownEndsAt,
    retryAfterMs: session.cooldownEndsAt.getTime() - now.getTime(),
  };
}

/** Compute the new `cooldown_ends_at` to persist after a request is accepted. */
export function computeNextCooldownEndsAt(
  now: Date,
  cooldownMs: number = REQUEST_COOLDOWN_MS,
): Date {
  return new Date(now.getTime() + cooldownMs);
}

export interface SessionExpiryFields {
  isActive: boolean;
  lastActiveAt: Date;
}

export interface SessionExpiryDecision {
  expired: boolean;
  /** The instant this session will/did expire, given its last activity. */
  expiresAt: Date;
}

/** Has this session lapsed from 1h inactivity (or already been deactivated)? */
export function checkSessionExpiry(
  session: SessionExpiryFields,
  now: Date,
  expiryMs: number = SESSION_EXPIRY_MS,
): SessionExpiryDecision {
  const expiresAt = new Date(session.lastActiveAt.getTime() + expiryMs);
  const expired = !session.isActive || now.getTime() >= expiresAt.getTime();
  return { expired, expiresAt };
}
