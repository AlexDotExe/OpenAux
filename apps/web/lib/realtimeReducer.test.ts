import { describe, expect, it } from 'vitest';
import type { QueueItem, QueueSnapshot, RealtimeEvent } from '@openaux/shared';

import { applyRealtimeEvent, initialVenueChannelState } from './realtimeReducer';

function makeSnapshot(): QueueSnapshot {
  return { nowPlaying: null, upNext: [], rest: [] };
}

function makeQueueItem(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    queueItemId: 'qi-1',
    venueId: 'venue-1',
    songId: 'song-1',
    provider: 'spotify',
    requestingUserId: 'user-1',
    createdAt: new Date(),
    status: 'playing',
    upvotesCount: 0,
    downvotesCount: 0,
    uniqueSupporterCount: 0,
    priorityBoostCount: 0,
    instantVoteCount: 0,
    superBoostCount: 0,
    explicitFlag: false,
    genre: null,
    artist: 'Artist',
    title: 'Title',
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

describe('applyRealtimeEvent', () => {
  it('starts from an empty state', () => {
    expect(initialVenueChannelState).toEqual({
      queue: null,
      nowPlaying: null,
      announcements: [],
      sessionExpired: false,
    });
  });

  it('replaces queue on queue_updated', () => {
    const snapshot = makeSnapshot();
    const event: RealtimeEvent = { type: 'queue_updated', payload: snapshot };
    const next = applyRealtimeEvent(initialVenueChannelState, event);
    expect(next.queue).toBe(snapshot);
  });

  it('sets nowPlaying on now_playing_changed', () => {
    const item = makeQueueItem();
    const event: RealtimeEvent = {
      type: 'now_playing_changed',
      payload: { queueItem: item, djAttribution: 'Alex' },
    };
    const next = applyRealtimeEvent(initialVenueChannelState, event);
    expect(next.nowPlaying).toEqual({ queueItem: item, djAttribution: 'Alex' });
  });

  it('appends announcements and assigns each a unique id', () => {
    const event: RealtimeEvent = {
      type: 'announcement',
      payload: { kind: 'dj_attribution', text: 'DJ Alex is playing…', ttlSeconds: 10 },
    };
    let state = applyRealtimeEvent(initialVenueChannelState, event);
    state = applyRealtimeEvent(state, event);
    expect(state.announcements).toHaveLength(2);
    expect(state.announcements[0]!.id).not.toEqual(state.announcements[1]!.id);
    expect(state.announcements[0]!.kind).toBe('dj_attribution');
  });

  it('dismisses an announcement by id', () => {
    const event: RealtimeEvent = {
      type: 'announcement',
      payload: { kind: 'venue_anthem', text: 'Anthem set', ttlSeconds: 20 },
    };
    const withAnnouncement = applyRealtimeEvent(initialVenueChannelState, event);
    const id = withAnnouncement.announcements[0]!.id;
    const dismissed = applyRealtimeEvent(withAnnouncement, { type: 'dismiss_announcement', id });
    expect(dismissed.announcements).toHaveLength(0);
  });

  it('marks session as expired', () => {
    const event: RealtimeEvent = { type: 'session_expired', payload: { sessionId: 'session-1' } };
    const next = applyRealtimeEvent(initialVenueChannelState, event);
    expect(next.sessionExpired).toBe(true);
  });

  it('is a pure function — does not mutate the input state', () => {
    const before = JSON.parse(JSON.stringify(initialVenueChannelState));
    applyRealtimeEvent(initialVenueChannelState, {
      type: 'session_expired',
      payload: { sessionId: 'x' },
    });
    expect(initialVenueChannelState).toEqual(before);
  });
});
