/**
 * Periodic sweep job: expires sessions that have lapsed from 1h inactivity and
 * emits `user_session_expired` (SPEC.md §1 layer 6 / §5 V0 anti-spam).
 *
 * DB access is behind `SessionRepository` so this is unit-testable without a
 * live database — inject a stub in tests, a pg-backed one (`pg-repositories.ts`)
 * at runtime.
 */

import { emitAnalyticsEvent as defaultEmitAnalyticsEvent } from '../analytics/index.js';
import type { EmitAnalyticsEventInput } from '../analytics/index.js';
import { checkSessionExpiry, SESSION_EXPIRY_MS } from './cooldown.js';

export interface ExpiredSessionCandidate {
  sessionId: string;
  userId: string;
  venueId: string;
  lastActiveAt: Date;
  /** Start of the session — with lastActiveAt this gives the time spent in venue. */
  joinedAt: Date;
}

export interface SessionRepository {
  /** Sessions still marked active whose last_active_at is at/older than `cutoff`. */
  findActiveSessionsOlderThan(cutoff: Date): Promise<ExpiredSessionCandidate[]>;
  /** Marks a session inactive + stamps session_expired_at; must be idempotent. */
  markSessionExpired(sessionId: string, expiredAt: Date): Promise<void>;
}

export interface AntispamSweeperDeps {
  sessionRepository: SessionRepository;
  /** Defaults to the real analytics pipeline; override in tests. */
  emitEvent?: (event: EmitAnalyticsEventInput) => void;
  now?: () => Date;
  /** How often the sweep runs. Default 60s. */
  sweepIntervalMs?: number;
  /** Inactivity threshold. Default SESSION_EXPIRY_MS (1h). */
  sessionExpiryMs?: number;
  onError?: (error: unknown) => void;
  /**
   * Called for each expired session with the time actually spent in the venue.
   * Reputation v2 (SPEC.md §5 V2) plugs in here. Fire-and-forget: reputation is
   * an anti-spam input, never a precondition, so it must not fail the sweep.
   */
  onSessionEnded?: (input: { userId: string; venueId: string; seconds: number }) => void;
}

export interface AntispamSweeper {
  stop: () => void;
  /** Runs one sweep pass immediately; exposed for tests and manual triggers. */
  runOnce: () => Promise<number>;
}

const DEFAULT_SWEEP_INTERVAL_MS = 60 * 1000;

/** One sweep pass: find+expire stale sessions, emit an event per expiry. Returns count expired. */
export async function runExpirySweepOnce(deps: AntispamSweeperDeps): Promise<number> {
  const now = deps.now?.() ?? new Date();
  const sessionExpiryMs = deps.sessionExpiryMs ?? SESSION_EXPIRY_MS;
  const emit = deps.emitEvent ?? defaultEmitAnalyticsEvent;
  const cutoff = new Date(now.getTime() - sessionExpiryMs);

  const candidates = await deps.sessionRepository.findActiveSessionsOlderThan(cutoff);
  let expiredCount = 0;

  for (const candidate of candidates) {
    const { expired } = checkSessionExpiry(
      { isActive: true, lastActiveAt: candidate.lastActiveAt },
      now,
      sessionExpiryMs,
    );
    if (!expired) continue;

    try {
      await deps.sessionRepository.markSessionExpired(candidate.sessionId, now);
      emit({
        eventType: 'user_session_expired',
        actorUserId: candidate.userId,
        venueId: candidate.venueId,
        queueItemId: null,
        metadata: {
          sessionId: candidate.sessionId,
          lastActiveAt: candidate.lastActiveAt.toISOString(),
        },
        eventTimestamp: now,
      });
      deps.onSessionEnded?.({
        userId: candidate.userId,
        venueId: candidate.venueId,
        seconds: Math.max(
          0,
          Math.round((candidate.lastActiveAt.getTime() - candidate.joinedAt.getTime()) / 1000),
        ),
      });
      expiredCount += 1;
    } catch (error) {
      deps.onError?.(error);
    }
  }

  return expiredCount;
}

/** Starts the setInterval-based sweeper. Call `.stop()` to clear it (tests, shutdown). */
export function startAntispamSweeper(deps: AntispamSweeperDeps): AntispamSweeper {
  const intervalMs = deps.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;

  const timer = setInterval(() => {
    runExpirySweepOnce(deps).catch((error) => deps.onError?.(error));
  }, intervalMs);
  timer.unref?.();

  return {
    stop: () => clearInterval(timer),
    runOnce: () => runExpirySweepOnce(deps),
  };
}
