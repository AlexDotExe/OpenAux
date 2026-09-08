import { describe, expect, it, vi } from 'vitest';
import {
  computeReputationScore,
  DEFAULT_REPUTATION_WEIGHTS,
  recordEngagement,
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
  songsPlayed: 0,
  timeInVenueSeconds: 0,
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

  // --- Reputation v2 (SPEC.md §5 V2): reward all engagement -----------------

  it('adds songs played at +3 each', () => {
    expect(computeReputationScore(counters({ songsPlayed: 4 }))).toBe(12);
  });

  it('adds time in venue at +0.1 per minute (not per second)', () => {
    // 600s = 10 minutes → 10 * 0.1 = 1
    expect(computeReputationScore(counters({ timeInVenueSeconds: 600 }))).toBeCloseTo(1, 10);
    // 3600s = 1 hour → 60 * 0.1 = 6
    expect(computeReputationScore(counters({ timeInVenueSeconds: 3600 }))).toBeCloseTo(6, 10);
  });

  it('lets engagement offset v1 penalties instead of only punishing', () => {
    // v1 alone would be −5 → clamped to 0; +2 played songs (+6) lifts it to 1.
    expect(computeReputationScore(counters({ spamAttempts: 1 }))).toBe(REPUTATION_FLOOR);
    expect(computeReputationScore(counters({ spamAttempts: 1, songsPlayed: 2 }))).toBe(1);
  });

  it('keeps every v1 term alongside the v2 terms', () => {
    // +10 − 1*2 − 5*1 − 2*2 + 3*3 + 0.1*(1200/60) = 10 − 2 − 5 − 4 + 9 + 2 = 10
    const score = computeReputationScore(
      counters({
        upvotesReceived: 10,
        downvotesReceived: 2,
        spamAttempts: 1,
        songsSkipped: 2,
        songsPlayed: 3,
        timeInVenueSeconds: 1200,
      }),
    );
    expect(score).toBeCloseTo(10, 10);
  });

  it('still clamps at REPUTATION_FLOOR when engagement cannot cover the penalties', () => {
    // −5*10 = −50, engagement only +3 +6 = +9 → −41 → 0
    const score = computeReputationScore(
      counters({ spamAttempts: 10, songsPlayed: 1, timeInVenueSeconds: 3600 }),
    );
    expect(score).toBe(REPUTATION_FLOOR);
  });

  it('honors injected weights for both v2 terms', () => {
    const score = computeReputationScore(counters({ songsPlayed: 2, timeInVenueSeconds: 120 }), {
      ...DEFAULT_REPUTATION_WEIGHTS,
      songPlayed: 10,
      timeInVenuePerMinute: 5,
    });
    // 2*10 + 2 minutes * 5 = 20 + 10 = 30
    expect(score).toBeCloseTo(30, 10);
  });

  it('is unchanged by the v2 terms when a user has no engagement', () => {
    const v1Only = counters({ upvotesReceived: 6, songsSkipped: 1 });
    expect(computeReputationScore(v1Only)).toBe(4);
  });
});

/** In-memory stub of the repository — no live DB anywhere in this suite. */
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
        songsPlayed: current.songsPlayed + (delta.songsPlayed ?? 0),
        timeInVenueSeconds: current.timeInVenueSeconds + (delta.timeInVenueSeconds ?? 0),
      };
      return { ...current };
    }),
    setReputationScore: vi.fn(async (_userId, score) => {
      saved.score = score;
    }),
  };
  return { repo, saved };
}

describe('updateReputation', () => {
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

describe('recordEngagement (Reputation v2)', () => {
  it('increments songsPlayed, recomputes, persists, and emits reputation_updated', async () => {
    const { repo, saved } = makeRepo(counters({ songsPlayed: 1 }));
    const emit = vi.fn();
    const now = new Date('2026-09-04T00:00:00.000Z');

    const result = await recordEngagement(
      { userId: 'u1', venueId: 'v1', songsPlayed: 1, queueItemId: 'qi1', reason: 'song_played' },
      { reputationRepository: repo, emitEvent: emit, now: () => now },
    );

    expect(repo.incrementCounters).toHaveBeenCalledWith('u1', {
      songsPlayed: 1,
      timeInVenueSeconds: 0,
    });
    expect(result.counters.songsPlayed).toBe(2);
    expect(result.reputationScore).toBe(6);
    expect(saved.score).toBe(6);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'reputation_updated',
        actorUserId: 'u1',
        venueId: 'v1',
        queueItemId: 'qi1',
        eventTimestamp: now,
        metadata: expect.objectContaining({
          reputationScore: 6,
          songsPlayed: 2,
          reason: 'song_played',
        }),
      }),
    );
  });

  it('adds a session duration to timeInVenueSeconds and raises the score', async () => {
    const { repo, saved } = makeRepo(counters());
    const result = await recordEngagement(
      { userId: 'u1', venueId: 'v1', timeInVenueSeconds: 1800 },
      { reputationRepository: repo, emitEvent: vi.fn() },
    );

    expect(result.counters.timeInVenueSeconds).toBe(1800);
    // 30 minutes * 0.1 = 3
    expect(result.reputationScore).toBeCloseTo(3, 10);
    expect(saved.score).toBeCloseTo(3, 10);
  });

  it('records both counters in a single update', async () => {
    const { repo } = makeRepo(counters());
    const result = await recordEngagement(
      { userId: 'u1', venueId: 'v1', songsPlayed: 2, timeInVenueSeconds: 600 },
      { reputationRepository: repo, emitEvent: vi.fn() },
    );
    expect(repo.setReputationScore).toHaveBeenCalledTimes(1);
    // 2*3 + 10 minutes * 0.1 = 7
    expect(result.reputationScore).toBeCloseTo(7, 10);
  });

  it('rounds fractional seconds (the column is an integer)', async () => {
    const { repo } = makeRepo(counters());
    const result = await recordEngagement(
      { userId: 'u1', venueId: 'v1', timeInVenueSeconds: 90.4 },
      { reputationRepository: repo, emitEvent: vi.fn() },
    );
    expect(result.counters.timeInVenueSeconds).toBe(90);
  });

  it('drops negative and non-finite amounts instead of decrementing', async () => {
    const { repo } = makeRepo(counters({ songsPlayed: 3, timeInVenueSeconds: 600 }));
    const result = await recordEngagement(
      { userId: 'u1', venueId: 'v1', songsPlayed: -5, timeInVenueSeconds: Number.NaN },
      { reputationRepository: repo, emitEvent: vi.fn() },
    );
    // All-zero delta ⇒ recompute-only read path, counters untouched.
    expect(repo.incrementCounters).not.toHaveBeenCalled();
    expect(result.counters.songsPlayed).toBe(3);
    expect(result.counters.timeInVenueSeconds).toBe(600);
    expect(result.reputationScore).toBeCloseTo(10, 10);
  });

  it('honors injected weights', async () => {
    const { repo, saved } = makeRepo(counters());
    const result = await recordEngagement(
      { userId: 'u1', venueId: 'v1', songsPlayed: 2, timeInVenueSeconds: 60 },
      {
        reputationRepository: repo,
        emitEvent: vi.fn(),
        weights: { ...DEFAULT_REPUTATION_WEIGHTS, songPlayed: 10, timeInVenuePerMinute: 2 },
      },
    );
    // 2*10 + 1 minute * 2 = 22
    expect(result.reputationScore).toBeCloseTo(22, 10);
    expect(saved.score).toBeCloseTo(22, 10);
  });

  it('still clamps at REPUTATION_FLOOR for a heavily penalised user', async () => {
    const { repo, saved } = makeRepo(counters({ spamAttempts: 20 }));
    const result = await recordEngagement(
      { userId: 'u1', venueId: 'v1', songsPlayed: 1, timeInVenueSeconds: 3600 },
      { reputationRepository: repo, emitEvent: vi.fn() },
    );
    // −100 + 3 + 6 = −91 → clamped
    expect(result.reputationScore).toBe(REPUTATION_FLOOR);
    expect(saved.score).toBe(REPUTATION_FLOOR);
  });

  it('defaults the analytics reason to engagement_recorded', async () => {
    const { repo } = makeRepo(counters());
    const emit = vi.fn();
    await recordEngagement(
      { userId: 'u1', venueId: 'v1', songsPlayed: 1 },
      { reputationRepository: repo, emitEvent: emit },
    );
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        queueItemId: null,
        metadata: expect.objectContaining({ reason: 'engagement_recorded' }),
      }),
    );
  });
});
