import { describe, expect, it, vi } from 'vitest';
import {
  computeReputationScore,
  DEFAULT_REPUTATION_WEIGHTS,
  REPUTATION_FLOOR,
  updateReputation,
  type ReputationCounters,
  type ReputationRepository,
} from './reputation.js';

const counters = (over: Partial<ReputationCounters> = {}): ReputationCounters => ({
  upvotesReceived: 0,
  downvotesReceived: 0,
  spamAttempts: 0,
  songsSkipped: 0,
  ...over,
});

describe('computeReputationScore', () => {
  it('is 0 for a brand-new user with no activity', () => {
    expect(computeReputationScore(counters())).toBe(0);
  });

  it('adds upvotes received', () => {
    expect(computeReputationScore(counters({ upvotesReceived: 7 }))).toBe(7);
  });

  it('subtracts downvotes, spam attempts, and songs skipped with default weights', () => {
    // +10 upvotes − (1*2 downvotes) − (5*1 spam) − (2*3 skips) = 10 − 2 − 5 − 6 = -3 → clamped 0
    const raw = computeReputationScore(
      counters({ upvotesReceived: 10, downvotesReceived: 2, spamAttempts: 1, songsSkipped: 3 }),
    );
    expect(raw).toBe(REPUTATION_FLOOR);
  });

  it('produces the exact weighted sum before the floor kicks in', () => {
    // +20 − 1*2 − 5*1 − 2*2 = 20 − 2 − 5 − 4 = 9
    expect(
      computeReputationScore(
        counters({ upvotesReceived: 20, downvotesReceived: 2, spamAttempts: 1, songsSkipped: 2 }),
      ),
    ).toBe(9);
  });

  it('clamps negative results to REPUTATION_FLOOR (0)', () => {
    expect(computeReputationScore(counters({ spamAttempts: 100 }))).toBe(REPUTATION_FLOOR);
  });

  it('honors custom weights', () => {
    const score = computeReputationScore(counters({ upvotesReceived: 4 }), {
      ...DEFAULT_REPUTATION_WEIGHTS,
      upvoteReceived: 3,
    });
    expect(score).toBe(12);
  });
});

describe('updateReputation', () => {
  function makeRepo(initial: ReputationCounters): {
    repo: ReputationRepository;
    saved: { score: number | null };
  } {
    let current = { ...initial };
    const saved = { score: null as number | null };
    const repo: ReputationRepository = {
      getCounters: vi.fn(async () => ({ ...current })),
      incrementCounters: vi.fn(async (_userId, delta) => {
        current = {
          upvotesReceived: current.upvotesReceived + (delta.upvotesReceived ?? 0),
          downvotesReceived: current.downvotesReceived + (delta.downvotesReceived ?? 0),
          spamAttempts: current.spamAttempts + (delta.spamAttempts ?? 0),
          songsSkipped: current.songsSkipped + (delta.songsSkipped ?? 0),
        };
        return { ...current };
      }),
      setReputationScore: vi.fn(async (_userId, score) => {
        saved.score = score;
      }),
    };
    return { repo, saved };
  }

  it('applies a delta, recomputes, persists, and emits reputation_updated', async () => {
    const { repo, saved } = makeRepo(counters({ upvotesReceived: 3 }));
    const emit = vi.fn();
    const now = new Date('2026-09-03T00:00:00.000Z');

    const result = await updateReputation(
      { userId: 'u1', venueId: 'v1', delta: { upvotesReceived: 2 }, reason: 'vote_added' },
      { reputationRepository: repo, emitEvent: emit, now: () => now },
    );

    expect(repo.incrementCounters).toHaveBeenCalledWith('u1', { upvotesReceived: 2 });
    expect(result.counters.upvotesReceived).toBe(5);
    expect(result.reputationScore).toBe(5);
    expect(saved.score).toBe(5);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'reputation_updated',
        actorUserId: 'u1',
        venueId: 'v1',
        eventTimestamp: now,
        metadata: expect.objectContaining({ reputationScore: 5, reason: 'vote_added' }),
      }),
    );
  });

  it('recomputes from current counters when no delta is given (read path)', async () => {
    const { repo, saved } = makeRepo(counters({ upvotesReceived: 8, songsSkipped: 1 }));
    const emit = vi.fn();

    const result = await updateReputation(
      { userId: 'u1', venueId: 'v1' },
      { reputationRepository: repo, emitEvent: emit },
    );

    expect(repo.incrementCounters).not.toHaveBeenCalled();
    expect(repo.getCounters).toHaveBeenCalledWith('u1');
    // 8 − 2*1 = 6
    expect(result.reputationScore).toBe(6);
    expect(saved.score).toBe(6);
  });

  it('treats an unknown user (null counters, no delta) as zero', async () => {
    const repo: ReputationRepository = {
      getCounters: vi.fn(async () => null),
      incrementCounters: vi.fn(),
      setReputationScore: vi.fn(),
    };
    const result = await updateReputation(
      { userId: 'ghost', venueId: 'v1' },
      { reputationRepository: repo, emitEvent: vi.fn() },
    );
    expect(result.reputationScore).toBe(0);
    expect(repo.setReputationScore).toHaveBeenCalledWith('ghost', 0);
  });

  it('ignores an all-zero delta and uses the read path', async () => {
    const { repo } = makeRepo(counters({ upvotesReceived: 4 }));
    await updateReputation(
      { userId: 'u1', venueId: 'v1', delta: { upvotesReceived: 0 } },
      { reputationRepository: repo, emitEvent: vi.fn() },
    );
    expect(repo.incrementCounters).not.toHaveBeenCalled();
    expect(repo.getCounters).toHaveBeenCalled();
  });
});
