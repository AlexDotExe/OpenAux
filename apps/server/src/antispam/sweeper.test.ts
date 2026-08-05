import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  runExpirySweepOnce,
  startAntispamSweeper,
  type ExpiredSessionCandidate,
  type SessionRepository,
} from './sweeper.js';

function makeRepo(candidates: ExpiredSessionCandidate[]): SessionRepository {
  return {
    findActiveSessionsOlderThan: vi.fn().mockResolvedValue(candidates),
    markSessionExpired: vi.fn().mockResolvedValue(undefined),
  };
}

describe('runExpirySweepOnce', () => {
  const now = new Date('2026-07-24T23:00:00Z');

  it('expires each stale session and emits user_session_expired for it', async () => {
    const candidates: ExpiredSessionCandidate[] = [
      {
        sessionId: 's-1',
        userId: 'u-1',
        venueId: 'v-1',
        lastActiveAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
      },
      {
        sessionId: 's-2',
        userId: 'u-2',
        venueId: 'v-1',
        lastActiveAt: new Date(now.getTime() - 90 * 60 * 1000),
      },
    ];
    const sessionRepository = makeRepo(candidates);
    const emitEvent = vi.fn();

    const count = await runExpirySweepOnce({ sessionRepository, emitEvent, now: () => now });

    expect(count).toBe(2);
    expect(sessionRepository.markSessionExpired).toHaveBeenCalledTimes(2);
    expect(sessionRepository.markSessionExpired).toHaveBeenCalledWith('s-1', now);
    expect(sessionRepository.markSessionExpired).toHaveBeenCalledWith('s-2', now);
    expect(emitEvent).toHaveBeenCalledTimes(2);
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'user_session_expired',
        actorUserId: 'u-1',
        venueId: 'v-1',
        queueItemId: null,
      }),
    );
  });

  it('queries the repository with a cutoff derived from now - sessionExpiryMs', async () => {
    const sessionRepository = makeRepo([]);
    await runExpirySweepOnce({ sessionRepository, now: () => now, sessionExpiryMs: 5000 });

    expect(sessionRepository.findActiveSessionsOlderThan).toHaveBeenCalledWith(
      new Date(now.getTime() - 5000),
    );
  });

  it('does not mark or emit for a candidate that is not actually past expiry', async () => {
    // Repository returns a borderline candidate; the sweep re-validates via checkSessionExpiry.
    const candidates: ExpiredSessionCandidate[] = [
      {
        sessionId: 's-1',
        userId: 'u-1',
        venueId: 'v-1',
        lastActiveAt: new Date(now.getTime() - 1000),
      },
    ];
    const sessionRepository = makeRepo(candidates);
    const emitEvent = vi.fn();

    const count = await runExpirySweepOnce({
      sessionRepository,
      emitEvent,
      now: () => now,
      sessionExpiryMs: 60_000,
    });

    expect(count).toBe(0);
    expect(sessionRepository.markSessionExpired).not.toHaveBeenCalled();
    expect(emitEvent).not.toHaveBeenCalled();
  });

  it('reports failures via onError and continues processing other candidates', async () => {
    const candidates: ExpiredSessionCandidate[] = [
      {
        sessionId: 's-1',
        userId: 'u-1',
        venueId: 'v-1',
        lastActiveAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
      },
      {
        sessionId: 's-2',
        userId: 'u-2',
        venueId: 'v-1',
        lastActiveAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
      },
    ];
    const sessionRepository: SessionRepository = {
      findActiveSessionsOlderThan: vi.fn().mockResolvedValue(candidates),
      markSessionExpired: vi
        .fn()
        .mockRejectedValueOnce(new Error('db down'))
        .mockResolvedValueOnce(undefined),
    };
    const emitEvent = vi.fn();
    const onError = vi.fn();

    const count = await runExpirySweepOnce({
      sessionRepository,
      emitEvent,
      onError,
      now: () => now,
    });

    expect(count).toBe(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(emitEvent).toHaveBeenCalledTimes(1);
  });
});

describe('startAntispamSweeper', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs a sweep on each interval tick and can be stopped', async () => {
    vi.useFakeTimers();
    const sessionRepository = makeRepo([]);
    const emitEvent = vi.fn();

    const sweeper = startAntispamSweeper({ sessionRepository, emitEvent, sweepIntervalMs: 1000 });

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sessionRepository.findActiveSessionsOlderThan).toHaveBeenCalledTimes(2);

    sweeper.stop();
    await vi.advanceTimersByTimeAsync(3000);
    expect(sessionRepository.findActiveSessionsOlderThan).toHaveBeenCalledTimes(2);
  });

  it('exposes runOnce for immediate/manual sweeps', async () => {
    const sessionRepository = makeRepo([]);
    const sweeper = startAntispamSweeper({
      sessionRepository,
      emitEvent: vi.fn(),
      sweepIntervalMs: 60_000,
    });

    const count = await sweeper.runOnce();

    expect(count).toBe(0);
    expect(sessionRepository.findActiveSessionsOlderThan).toHaveBeenCalledTimes(1);
    sweeper.stop();
  });
});
