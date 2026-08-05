import { describe, expect, it, vi } from 'vitest';
import {
  computeArtistRepeatPenalty,
  computeSpamPenalty,
  createFrictionProvider,
  DEFAULT_ARTIST_REPEAT_PENALTY,
  DEFAULT_SPAM_PENALTY_PER_OFFENDER,
  type RecentlyPlayedArtistsRepository,
  type VoteActivityRepository,
} from './friction.js';

describe('computeArtistRepeatPenalty', () => {
  it('is 0 when the artist is not in the recent window', () => {
    expect(computeArtistRepeatPenalty(['Drake', 'SZA'], 'Beyonce')).toBe(0);
  });

  it('applies the default penalty when the artist repeats', () => {
    expect(computeArtistRepeatPenalty(['Drake', 'SZA'], 'Drake')).toBe(
      DEFAULT_ARTIST_REPEAT_PENALTY,
    );
  });

  it('honors a configurable penalty value', () => {
    expect(computeArtistRepeatPenalty(['Drake'], 'Drake', 5)).toBe(5);
  });

  it('is 0 for an empty recent-artists window', () => {
    expect(computeArtistRepeatPenalty([], 'Drake')).toBe(0);
  });
});

describe('computeSpamPenalty', () => {
  it('is 0 when no supporter exceeds the vote threshold', () => {
    const counts = new Map([
      ['user-1', 1],
      ['user-2', 3],
    ]);
    expect(computeSpamPenalty(counts)).toBe(0);
  });

  it('penalizes once per offender exceeding the threshold', () => {
    const counts = new Map([
      ['user-1', 4],
      ['user-2', 10],
      ['user-3', 2],
    ]);
    expect(computeSpamPenalty(counts)).toBe(2 * DEFAULT_SPAM_PENALTY_PER_OFFENDER);
  });

  it('accepts a plain Record in addition to a Map', () => {
    expect(computeSpamPenalty({ 'user-1': 4, 'user-2': 1 })).toBe(
      1 * DEFAULT_SPAM_PENALTY_PER_OFFENDER,
    );
  });

  it('honors a configurable threshold and per-offender penalty', () => {
    const counts = new Map([
      ['user-1', 2],
      ['user-2', 3],
    ]);
    expect(computeSpamPenalty(counts, 1, 3)).toBe(2 * 3); // both users exceed threshold=1
  });

  it('is 0 for empty vote counts', () => {
    expect(computeSpamPenalty(new Map())).toBe(0);
  });
});

describe('createFrictionProvider', () => {
  const now = new Date('2026-07-24T22:00:00Z');

  function makeDeps(overrides?: { recentArtists?: string[]; voteCounts?: Map<string, number> }) {
    const recentArtistsRepository: RecentlyPlayedArtistsRepository = {
      getRecentArtists: vi.fn().mockResolvedValue(overrides?.recentArtists ?? []),
    };
    const voteActivityRepository: VoteActivityRepository = {
      getVoteCountsSince: vi.fn().mockResolvedValue(overrides?.voteCounts ?? new Map()),
    };
    return { recentArtistsRepository, voteActivityRepository };
  }

  it('combines artist-repeat and spam penalties from repository queries', async () => {
    const deps = makeDeps({
      recentArtists: ['Drake', 'SZA'],
      voteCounts: new Map([['user-1', 5]]),
    });
    const provider = createFrictionProvider(deps);

    const result = await provider.getFriction(
      { venueId: 'venue-1', artist: 'Drake', supporterUserIds: ['user-1'] },
      now,
    );

    expect(result.artistRepeatPenalty).toBe(DEFAULT_ARTIST_REPEAT_PENALTY);
    expect(result.spamPenalty).toBe(DEFAULT_SPAM_PENALTY_PER_OFFENDER);
  });

  it('returns zero friction when nothing is repeated or spammy', async () => {
    const deps = makeDeps({ recentArtists: ['SZA'], voteCounts: new Map([['user-1', 1]]) });
    const provider = createFrictionProvider(deps);

    const result = await provider.getFriction(
      { venueId: 'venue-1', artist: 'Drake', supporterUserIds: ['user-1'] },
      now,
    );

    expect(result).toEqual({ artistRepeatPenalty: 0, spamPenalty: 0 });
  });

  it('skips the vote-activity query when there are no supporters', async () => {
    const deps = makeDeps();
    const provider = createFrictionProvider(deps);

    await provider.getFriction({ venueId: 'venue-1', artist: 'Drake', supporterUserIds: [] }, now);

    expect(deps.voteActivityRepository.getVoteCountsSince).not.toHaveBeenCalled();
  });

  it('queries vote activity using the configured spam window relative to now', async () => {
    const deps = makeDeps();
    const provider = createFrictionProvider(deps, {
      artistRepeatLookbackTracks: 5,
      artistRepeatPenalty: 2,
      spamVoteWindowMinutes: 10,
      spamVoteThreshold: 3,
      spamPenaltyPerOffender: 1,
    });

    await provider.getFriction(
      { venueId: 'venue-1', artist: 'Drake', supporterUserIds: ['user-1'] },
      now,
    );

    expect(deps.voteActivityRepository.getVoteCountsSince).toHaveBeenCalledWith(
      'venue-1',
      ['user-1'],
      new Date(now.getTime() - 10 * 60 * 1000),
    );
  });
});
