import { describe, expect, it, vi } from 'vitest';
import type { QueueItem, RealtimeEvent } from '@openaux/shared';
import {
  buildAnthemWonText,
  buildDjAttributionText,
  buildVenueAnthemAnnouncementText,
  createAnnouncementsService,
} from './announcements.js';
import type { AnthemConfig, Broadcaster, VenueRepository } from './types.js';

function makeQueueItem(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    queueItemId: 'qi-1',
    venueId: 'venue-1',
    songId: 'track-123',
    provider: 'spotify',
    requestingUserId: 'user-1',
    createdAt: new Date('2026-07-24T00:00:00Z'),
    status: 'playing',
    upvotesCount: 0,
    downvotesCount: 0,
    uniqueSupporterCount: 0,
    priorityBoostCount: 0,
    instantVoteCount: 0,
    superBoostCount: 0,
    explicitFlag: false,
    genre: null,
    artist: 'Some Artist',
    title: 'Some Song',
    isDuplicateLocked: false,
    lastScoreCalculatedAt: null,
    currentScore: 0,
    playabilityState: 'playable',
    playabilityReason: null,
    sourceType: 'organic',
    playedAt: null,
    crowdSkipVotes: 0,
    ...overrides,
  };
}

describe('buildDjAttributionText', () => {
  it('credits the requesting patron for organic requests', () => {
    const text = buildDjAttributionText(
      { title: 'Song', artist: 'Artist', sourceType: 'organic' },
      'Alex',
    );
    expect(text).toBe('DJ Alex is playing "Song" by Artist');
  });

  it('attributes venue overrides to the venue, not a "DJ"', () => {
    const text = buildDjAttributionText(
      { title: 'Song', artist: 'Artist', sourceType: 'override' },
      'Venue',
    );
    expect(text).toContain('The venue is now playing');
  });
});

describe('buildVenueAnthemAnnouncementText / buildAnthemWonText', () => {
  it('announces the configured anthem', () => {
    const text = buildVenueAnthemAnnouncementText({
      title: 'Anthem',
      artist: 'DJ X',
      promoText: '$1 shots',
    });
    expect(text).toContain('Anthem');
    expect(text).toContain('$1 shots');
  });

  it('builds a win celebration referencing the promo', () => {
    expect(buildAnthemWonText('Free shot!')).toContain('Free shot!');
  });
});

describe('createAnnouncementsService.notifyNowPlaying', () => {
  function makeDeps(anthem: AnthemConfig | null) {
    const events: RealtimeEvent[] = [];
    const broadcaster: Broadcaster = {
      broadcastToVenue: (_venueId, event) => {
        events.push(event);
      },
    };
    const repository: Pick<VenueRepository, 'getAnthem' | 'getUserDisplayName'> = {
      getAnthem: vi.fn().mockResolvedValue(anthem),
      getUserDisplayName: vi.fn().mockResolvedValue('Alex'),
    };
    return { events, broadcaster, repository };
  }

  it('always emits a dj_attribution announcement', async () => {
    const { events, broadcaster, repository } = makeDeps(null);
    const service = createAnnouncementsService({ repository, broadcaster });

    await service.notifyNowPlaying(makeQueueItem());

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'announcement', payload: { kind: 'dj_attribution' } });
  });

  it('also emits anthem_won when the now-playing item is the configured anthem', async () => {
    const anthem: AnthemConfig = {
      provider: 'spotify',
      providerTrackId: 'track-123',
      title: 'Some Song',
      artist: 'Some Artist',
      promoText: '$1 off shots',
      promoDurationMinutes: 5,
    };
    const { events, broadcaster, repository } = makeDeps(anthem);
    const service = createAnnouncementsService({ repository, broadcaster });

    await service.notifyNowPlaying(makeQueueItem({ songId: 'track-123', provider: 'spotify' }));

    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      type: 'announcement',
      payload: { kind: 'anthem_won', ttlSeconds: 5 * 60 },
    });
  });

  it('does not emit anthem_won when the now-playing item is not the anthem', async () => {
    const anthem: AnthemConfig = {
      provider: 'spotify',
      providerTrackId: 'track-999',
      title: 'Anthem Song',
      artist: 'Anthem Artist',
      promoText: '$1 off shots',
      promoDurationMinutes: 5,
    };
    const { events, broadcaster, repository } = makeDeps(anthem);
    const service = createAnnouncementsService({ repository, broadcaster });

    await service.notifyNowPlaying(makeQueueItem({ songId: 'track-123', provider: 'spotify' }));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ payload: { kind: 'dj_attribution' } });
  });
});
