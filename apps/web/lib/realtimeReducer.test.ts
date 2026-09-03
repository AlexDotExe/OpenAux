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
      powerHour: null,
      crowdSkip: null,
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

  it('sets and clears the Power Hour window on activated/ended', () => {
    const activated: RealtimeEvent = {
      type: 'power_hour_activated',
      payload: { genre: 'hip-hop', multiplier: 2, endsAt: '2026-09-03T23:00:00.000Z', bannerText: '🔥' },
    };
    const withPowerHour = applyRealtimeEvent(initialVenueChannelState, activated);
    expect(withPowerHour.powerHour).toEqual(activated.payload);

    const ended: RealtimeEvent = { type: 'power_hour_ended', payload: { genre: 'hip-hop' } };
    const cleared = applyRealtimeEvent(withPowerHour, ended);
    expect(cleared.powerHour).toBeNull();
  });

  it('tracks the crowd-skip tally and clears it when the song is skipped', () => {
    const update: RealtimeEvent = {
      type: 'crowd_skip_vote_update',
      payload: { queueItemId: 'qi-1', crowdSkipVotes: 3, threshold: 5 },
    };
    const withTally = applyRealtimeEvent(initialVenueChannelState, update);
    expect(withTally.crowdSkip).toEqual(update.payload);

    const skipped: RealtimeEvent = {
      type: 'song_crowd_skipped',
      payload: { queueItemId: 'qi-1', crowdSkipVotes: 5 },
    };
    expect(applyRealtimeEvent(withTally, skipped).crowdSkip).toBeNull();
  });

  it('resets the crowd-skip tally when a new song starts playing', () => {
    const update: RealtimeEvent = {
      type: 'crowd_skip_vote_update',
      payload: { queueItemId: 'qi-1', crowdSkipVotes: 2, threshold: 5 },
    };
    const withTally = applyRealtimeEvent(initialVenueChannelState, update);
    const nowPlaying: RealtimeEvent = {
      type: 'now_playing_changed',
      payload: { queueItem: makeQueueItem({ queueItemId: 'qi-2' }), djAttribution: null },
    };
    expect(applyRealtimeEvent(withTally, nowPlaying).crowdSkip).toBeNull();
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
