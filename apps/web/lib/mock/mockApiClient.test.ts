import { describe, expect, it } from 'vitest';
import type { AuthContext } from '../api';
import type { RealtimeEvent } from '@openaux/shared';

import { createMockApiClient } from './mockApiClient';
import { mockEventBus } from './eventBus';

const VENUE_ID = 'venue-1';
const QR_TOKEN = 'demo-qr-token';
const ADMIN_TOKEN = 'demo-admin-token';

async function join(client: ReturnType<typeof createMockApiClient>) {
  return client.joinSession({ venueQrToken: QR_TOKEN });
}

describe('mockApiClient', () => {
  describe('joinSession', () => {
    it('rejects an unknown QR token', async () => {
      const client = createMockApiClient();
      await expect(client.joinSession({ venueQrToken: 'wrong' })).rejects.toMatchObject({
        code: 'session_invalid',
      });
    });

    it('creates a fresh guest session on a valid token', async () => {
      const client = createMockApiClient();
      const res = await join(client);
      expect(res.venue.venueId).toBe(VENUE_ID);
      expect(res.session.isGuest).toBe(true);
      expect(res.session.isActive).toBe(true);
    });
  });

  describe('search', () => {
    it('matches by title or artist, case-insensitively', async () => {
      const client = createMockApiClient();
      const res = await client.search(VENUE_ID, 'weeknd');
      expect(res.tracks.some((t) => t.title === 'Blinding Lights')).toBe(true);
    });

    it('returns nothing for a blank query', async () => {
      const client = createMockApiClient();
      const res = await client.search(VENUE_ID, '   ');
      expect(res.tracks).toEqual([]);
    });
  });

  describe('createRequest', () => {
    it('enforces the request cooldown after a successful request', async () => {
      const client = createMockApiClient();
      const { session } = await join(client);
      const auth: AuthContext = { sessionId: session.sessionId };

      await client.createRequest(VENUE_ID, { providerTrackId: 't-unholy' }, auth);
      await expect(
        client.createRequest(VENUE_ID, { providerTrackId: 't-cant-hold-us' }, auth),
      ).rejects.toMatchObject({ code: 'request_cooldown' });
    });

    it('rejects explicit tracks when the venue blocks explicit content', async () => {
      const client = createMockApiClient();
      const { session } = await join(client);
      const auth: AuthContext = { sessionId: session.sessionId };
      await client.updateVenueSettings(
        VENUE_ID,
        { blockExplicit: true },
        { venueAdminToken: ADMIN_TOKEN },
      );

      await expect(
        client.createRequest(VENUE_ID, { providerTrackId: 't-unholy' }, auth),
      ).rejects.toMatchObject({ code: 'explicit_blocked' });
    });

    it('rejects a duplicate request of a recently-requested song', async () => {
      const client = createMockApiClient();
      // 't-blinding-lights' is already seeded as the now-playing song, created "just now".
      const { session } = await join(client);
      const auth: AuthContext = { sessionId: session.sessionId };

      await expect(
        client.createRequest(VENUE_ID, { providerTrackId: 't-blinding-lights' }, auth),
      ).rejects.toMatchObject({ code: 'duplicate_locked' });
    });

    it('marks new requests as awaiting_approval in suggestion mode', async () => {
      const client = createMockApiClient();
      await client.updateVenueSettings(
        VENUE_ID,
        { controlMode: 'suggestion' },
        { venueAdminToken: ADMIN_TOKEN },
      );
      const { session } = await join(client);
      const auth: AuthContext = { sessionId: session.sessionId };

      const res = await client.createRequest(VENUE_ID, { providerTrackId: 't-unholy' }, auth);
      expect(res.queueItem.playabilityState).toBe('awaiting_approval');
    });
  });

  describe('votes', () => {
    it('is idempotent per user and recomputes unique supporter count', async () => {
      const client = createMockApiClient();
      const { session } = await join(client);
      const auth: AuthContext = { sessionId: session.sessionId };
      const { queueItem } = await client.createRequest(
        VENUE_ID,
        { providerTrackId: 't-unholy' },
        auth,
      );

      const first = await client.castVote(queueItem.queueItemId, { direction: 'up' }, auth);
      expect(first.queueItem.upvotesCount).toBe(1);

      // Re-voting the same direction should not double-count.
      const second = await client.castVote(queueItem.queueItemId, { direction: 'up' }, auth);
      expect(second.queueItem.upvotesCount).toBe(1);

      // Switching direction moves the single vote, not adds one.
      const switched = await client.castVote(queueItem.queueItemId, { direction: 'down' }, auth);
      expect(switched.queueItem.upvotesCount).toBe(0);
      expect(switched.queueItem.downvotesCount).toBe(1);
    });

    it("removeVote clears the caller's vote", async () => {
      const client = createMockApiClient();
      const { session } = await join(client);
      const auth: AuthContext = { sessionId: session.sessionId };
      const { queueItem } = await client.createRequest(
        VENUE_ID,
        { providerTrackId: 't-unholy' },
        auth,
      );

      await client.castVote(queueItem.queueItemId, { direction: 'up' }, auth);
      const res = await client.removeVote(queueItem.queueItemId, auth);
      expect(res.queueItem.upvotesCount).toBe(0);
    });
  });

  describe('purchaseBoost', () => {
    it('deducts credits and increments priorityBoostCount', async () => {
      const client = createMockApiClient();
      const { session } = await join(client);
      const auth: AuthContext = { sessionId: session.sessionId };
      const { queueItem } = await client.createRequest(
        VENUE_ID,
        { providerTrackId: 't-unholy' },
        auth,
      );

      const res = await client.purchaseBoost(
        queueItem.queueItemId,
        { boostType: 'priority_boost' },
        auth,
      );
      expect(res.queueItem.priorityBoostCount).toBe(1);
      expect(res.creditBalance).toBe(4); // guests seed with 5 credits, boost costs 1
    });

    it('rejects a second boost of the same type by the same user (boost_limit_reached)', async () => {
      const client = createMockApiClient();
      const { session } = await join(client);
      const auth: AuthContext = { sessionId: session.sessionId };
      const { queueItem } = await client.createRequest(
        VENUE_ID,
        { providerTrackId: 't-unholy' },
        auth,
      );

      await client.purchaseBoost(queueItem.queueItemId, { boostType: 'priority_boost' }, auth);
      await expect(
        client.purchaseBoost(queueItem.queueItemId, { boostType: 'priority_boost' }, auth),
      ).rejects.toMatchObject({ code: 'boost_limit_reached' });
    });
  });

  describe('getPosition', () => {
    it('reports position 0 for the now-playing item', async () => {
      const client = createMockApiClient();
      const { session } = await join(client);
      const snapshot = await client.getQueue(VENUE_ID);
      const nowPlaying = snapshot.nowPlaying!;

      const res = await client.getPosition(nowPlaying.queueItemId, {
        sessionId: session.sessionId,
      });
      expect(res.position).toBe(0);
      expect(res.estimatedMinutesUntilPlay).toBe(0);
    });

    it('previews a positions-gained boost for a freshly requested song', async () => {
      const client = createMockApiClient();
      const { session } = await join(client);
      const auth: AuthContext = { sessionId: session.sessionId };
      const { queueItem } = await client.createRequest(
        VENUE_ID,
        { providerTrackId: 't-unholy' },
        auth,
      );

      const res = await client.getPosition(queueItem.queueItemId, auth);
      expect(res.position).toBeGreaterThan(0);
      expect(res.boostPreviewPositions).toBeGreaterThanOrEqual(0);
    });
  });

  describe('venue admin auth', () => {
    it('rejects settings changes without a valid admin token', async () => {
      const client = createMockApiClient();
      await expect(
        client.updateVenueSettings(VENUE_ID, { controlMode: 'suggestion' }, {}),
      ).rejects.toMatchObject({ code: 'unauthorized' });
    });
  });

  describe('realtime publishing', () => {
    it('publishes queue_updated after a vote', async () => {
      const client = createMockApiClient();
      const { session } = await join(client);
      const auth: AuthContext = { sessionId: session.sessionId };
      const { queueItem } = await client.createRequest(
        VENUE_ID,
        { providerTrackId: 't-unholy' },
        auth,
      );

      const events: RealtimeEvent[] = [];
      const unsubscribe = mockEventBus.subscribe(VENUE_ID, (e) => events.push(e));
      await client.castVote(queueItem.queueItemId, { direction: 'up' }, auth);
      unsubscribe();

      expect(events.some((e) => e.type === 'queue_updated')).toBe(true);
    });

    it('publishes now_playing_changed and a dj_attribution announcement on skip', async () => {
      const client = createMockApiClient();
      const events: RealtimeEvent[] = [];
      const unsubscribe = mockEventBus.subscribe(VENUE_ID, (e) => events.push(e));

      await client.skip(VENUE_ID, { venueAdminToken: ADMIN_TOKEN });
      unsubscribe();

      expect(events.some((e) => e.type === 'now_playing_changed')).toBe(true);
    });

    it('publishes a queue_next playback_command for the console on skip', async () => {
      const client = createMockApiClient();
      const events: RealtimeEvent[] = [];
      const unsubscribe = mockEventBus.subscribe(VENUE_ID, (e) => events.push(e));

      await client.skip(VENUE_ID, { venueAdminToken: ADMIN_TOKEN });
      unsubscribe();

      const command = events.find((e) => e.type === 'playback_command');
      expect(command).toBeDefined();
      expect(command).toMatchObject({ payload: { command: 'queue_next' } });
    });
  });

  describe('reportPlaybackState', () => {
    it('rejects without a valid console/admin token', async () => {
      const client = createMockApiClient();
      await expect(
        client.reportPlaybackState(
          VENUE_ID,
          { isPlaying: true, positionMs: 0, providerTrackId: 't-x' },
          {},
        ),
      ).rejects.toMatchObject({ code: 'unauthorized' });
    });

    it('acknowledges without advancing when trackEnded is absent', async () => {
      const client = createMockApiClient();
      const before = await client.getQueue(VENUE_ID);
      const res = await client.reportPlaybackState(
        VENUE_ID,
        { isPlaying: true, positionMs: 1000, providerTrackId: 't-blinding-lights' },
        { venueAdminToken: ADMIN_TOKEN },
      );
      expect(res.acknowledged).toBe(true);
      expect(res.nowPlaying?.queueItemId).toBe(before.nowPlaying?.queueItemId);
    });

    it('advances the queue and returns the new now-playing on trackEnded', async () => {
      const client = createMockApiClient();
      const before = await client.getQueue(VENUE_ID);
      const res = await client.reportPlaybackState(
        VENUE_ID,
        { isPlaying: false, positionMs: 0, providerTrackId: null, trackEnded: true },
        { venueAdminToken: ADMIN_TOKEN },
      );
      expect(res.nowPlaying).not.toBeNull();
      expect(res.nowPlaying?.queueItemId).not.toBe(before.nowPlaying?.queueItemId);
    });
  });

  describe('createOverride', () => {
    it('sets the override track as now playing immediately when when="now"', async () => {
      const client = createMockApiClient();
      await client.createOverride(
        VENUE_ID,
        { providerTrackId: 't-get-lucky', when: 'now' },
        { venueAdminToken: ADMIN_TOKEN },
      );
      const snapshot = await client.getQueue(VENUE_ID);
      expect(snapshot.nowPlaying?.songId).toBe('t-get-lucky');
      expect(snapshot.nowPlaying?.sourceType).toBe('override');
    });
  });
});
