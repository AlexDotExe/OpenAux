/**
 * DB-backed API integration suite (T2).
 *
 * Drives the real server over HTTP against a real Postgres, using the
 * deterministic fake music provider. This layer exists because the unit suite
 * stubs both the database and the provider, so it is structurally blind to SQL
 * and wiring bugs — two shipped showstoppers (a Postgres parameter-type error in
 * markFinished, and a provider call that failed every song request) were only
 * caught by running the app for real.
 *
 * Each run creates a FRESH owner and venue, so counts that depend on venue state
 * (notably the crowd-skip threshold, which scales with active users) are
 * deterministic instead of drifting with accumulated test data.
 *
 * Requires: docker compose -f docker-compose.test.yml up -d
 * Run with:  npm run test:integration
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { QueueItem, QueueSnapshot } from '@openaux/shared';
import pg from 'pg';
import { startServer, CONSOLE_TOKEN, TEST_DATABASE_URL, type RunningServer } from './helpers/server.js';
import { api, asAdmin, asSession, asUser, idempotent, FAKE_TRACKS } from './helpers/api.js';

let server: RunningServer;
let ctx: { baseUrl: string };

/** Shared state threaded through the ordered steps below. */
const state = {
  ownerToken: '',
  venueId: '',
  qrToken: '',
  patrons: [] as Array<{ sessionId: string; userId: string }>,
  items: [] as string[],
};

beforeAll(async () => {
  server = await startServer();
  ctx = { baseUrl: server.baseUrl };
}, 90_000);

afterAll(async () => {
  await server?.stop();
});

describe('venue setup', () => {
  it('registers an owner and creates a venue', async () => {
    const signup = await api.post<{ token: string }>(ctx, '/api/venue-owners/signup', {
      email: `integration-${randomUUID()}@example.test`,
      password: 'integration-password',
      displayName: 'Integration Owner',
    });
    expect(signup.token).toBeTruthy();
    state.ownerToken = signup.token;

    const created = await api.post<{ venue: { venueId: string; qrToken: string } }>(
      ctx,
      '/api/venues',
      { name: 'Integration Test Venue', musicProvider: 'spotify' },
      asAdmin(state.ownerToken),
    );
    expect(created.venue.venueId).toBeTruthy();
    state.venueId = created.venue.venueId;
    state.qrToken = created.venue.qrToken;
  });

  it('exposes the venue publicly', async () => {
    const venue = await api.get<{ venueId: string; powerHour: unknown }>(
      ctx,
      `/api/venues/${state.venueId}`,
    );
    expect(venue.venueId).toBe(state.venueId);
    expect(venue.powerHour).toBeNull();
  });

  it('404s an unknown venue instead of leaking a 500', async () => {
    await expect(api.get(ctx, `/api/venues/${randomUUID()}`)).rejects.toMatchObject({ status: 404 });
  });

  it('404s a malformed (non-uuid) venue id rather than a Postgres 22P02 500', async () => {
    // Regression: a non-uuid reached SQL and surfaced as HTTP 500
    // ("invalid input syntax for type uuid").
    await expect(api.get(ctx, '/api/venues/nonexistent')).rejects.toMatchObject({ status: 404 });
  });
});

describe('patrons join and request', () => {
  it('three patrons join via the QR token', async () => {
    for (let i = 0; i < 3; i += 1) {
      const joined = await api.post<{ session: { sessionId: string; userId: string } }>(
        ctx,
        '/api/sessions/join',
        { venueQrToken: state.qrToken },
      );
      expect(joined.session.sessionId).toBeTruthy();
      state.patrons.push(joined.session);
    }
    expect(state.patrons).toHaveLength(3);
  });

  it('rejects an authToken join when no sign-in provider is configured (fails closed)', async () => {
    // Security: an unverifiable token must be REJECTED, never silently
    // downgraded to a guest identity. The test server sets no GOOGLE_CLIENT_ID
    // or APPLE_CLIENT_ID, so sign-in is disabled here.
    await expect(
      api.post(ctx, '/api/sessions/join', {
        venueQrToken: state.qrToken,
        authToken: 'not-a-real-id-token',
      }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('rejects a bad QR token', async () => {
    await expect(
      api.post(ctx, '/api/sessions/join', { venueQrToken: 'not-a-real-token' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('each patron requests a track from the catalog', async () => {
    for (let i = 0; i < 3; i += 1) {
      const res = await api.post<{ queueItem: QueueItem }>(
        ctx,
        `/api/venues/${state.venueId}/requests`,
        { providerTrackId: FAKE_TRACKS[i] },
        asSession(state.patrons[i]!.sessionId),
      );
      expect(res.queueItem.status).toBe('queued');
      state.items.push(res.queueItem.queueItemId);
    }
  });

  it('search returns catalog results for a session', async () => {
    const res = await api.get<{ tracks: unknown[] }>(
      ctx,
      `/api/venues/${state.venueId}/search?q=track`,
      asSession(state.patrons[0]!.sessionId),
    );
    expect(Array.isArray(res.tracks)).toBe(true);
  });

  it('requires identity for catalog search, and accepts EITHER a session or venue admin', async () => {
    // Regression: search shipped session-gated while the web client sent no auth
    // at all, so "add a song" failed with "Missing session." — and the venue
    // console (anthem/override/fallback) has no patron session, so it needs the
    // admin token to search at all.
    await expect(
      api.get(ctx, `/api/venues/${state.venueId}/search?q=track`),
    ).rejects.toMatchObject({ status: 401 });

    const asOwner = await api.get<{ tracks: unknown[] }>(
      ctx,
      `/api/venues/${state.venueId}/search?q=track`,
      asAdmin(state.ownerToken),
    );
    expect(Array.isArray(asOwner.tracks)).toBe(true);
  });

  it('enforces the duplicate lockout', async () => {
    await expect(
      api.post(
        ctx,
        `/api/venues/${state.venueId}/requests`,
        { providerTrackId: FAKE_TRACKS[0] },
        asSession(state.patrons[0]!.sessionId),
      ),
    ).rejects.toMatchObject({ code: 'duplicate_locked' });
  });
});

describe('voting and ranking', () => {
  it('records votes and applies the V0 scoring formula', async () => {
    // Two upvotes on item 0 from the other two patrons.
    for (const p of state.patrons.slice(1)) {
      await api.put(
        ctx,
        `/api/queue-items/${state.items[0]}/vote`,
        { direction: 'up' },
        asSession(p.sessionId),
      );
    }
    const downvoted = await api.put<{ queueItem: QueueItem }>(
      ctx,
      `/api/queue-items/${state.items[2]}/vote`,
      { direction: 'down' },
      asSession(state.patrons[0]!.sessionId),
    );
    expect(downvoted.queueItem.downvotesCount).toBe(1);

    const snapshot = await api.get<QueueSnapshot>(ctx, `/api/venues/${state.venueId}/queue`);
    const byId = new Map(snapshot.upNext.map((i) => [i.queueItemId, i]));

    // RequestBase 2 + 2 upvotes + 0.5 x 2 unique supporters = 5
    expect(byId.get(state.items[0]!)?.currentScore).toBeCloseTo(5, 5);
    // RequestBase 2 - 1.25 x 1 downvote = 0.75
    expect(byId.get(state.items[2]!)?.currentScore).toBeCloseTo(0.75, 5);
    // Highest score ranks first.
    expect(snapshot.upNext[0]?.queueItemId).toBe(state.items[0]);
  });
});

describe('money: credits, boosts, ledger', () => {
  it('buys a credit bundle through the payment gateway', async () => {
    const res = await api.post<{ creditBalance: number }>(
      ctx,
      '/api/credits/purchase',
      { bundleId: 'starter_5', paymentMethodToken: 'pm_card_visa' },
      { ...asUser(state.patrons[0]!.userId, state.venueId), ...idempotent() },
    );
    expect(res.creditBalance).toBe(5);
  });

  it('applies a Priority Boost and an Instant Play Vote with the right paid points', async () => {
    const priority = await api.post<{ paidPointsAdded: number; creditBalance: number }>(
      ctx,
      `/api/queue-items/${state.items[1]}/boosts`,
      { boostType: 'priority_boost' },
      { ...asUser(state.patrons[0]!.userId), ...idempotent() },
    );
    expect(priority.paidPointsAdded).toBe(1);
    expect(priority.creditBalance).toBe(4);

    const instant = await api.post<{ paidPointsAdded: number; creditBalance: number }>(
      ctx,
      `/api/queue-items/${state.items[1]}/boosts`,
      { boostType: 'instant_play_vote' },
      { ...asUser(state.patrons[0]!.userId), ...idempotent() },
    );
    expect(instant.paidPointsAdded).toBe(4);
    expect(instant.creditBalance).toBe(1);
  });

  it('accepts the uniform X-Session-Id transport, deriving the venue from the session', async () => {
    // Issue #85: payment endpoints historically required X-User-Id (+ X-Venue-Id).
    // They now also accept the same X-Session-Id every other patron endpoint uses,
    // with venue context resolved from the session row rather than the client.
    const res = await api.post<{ creditBalance: number }>(
      ctx,
      '/api/credits/purchase',
      { bundleId: 'starter_5', paymentMethodToken: 'pm_card_visa' },
      { ...asSession(state.patrons[2]!.sessionId), ...idempotent() },
    );
    expect(res.creditBalance).toBe(5);
  });

  it('rejects a boost the patron cannot afford', async () => {
    await expect(
      api.post(
        ctx,
        `/api/queue-items/${state.items[2]}/boosts`,
        { boostType: 'instant_play_vote' },
        { ...asUser(state.patrons[0]!.userId), ...idempotent() },
      ),
    ).rejects.toMatchObject({ code: 'insufficient_credits' });
  });
});

describe('playback advance', () => {
  it('advances the queue and promotes the top item to playing', async () => {
    const res = await api.post<{ nowPlaying: QueueItem | null }>(
      ctx,
      `/api/venues/${state.venueId}/playback/state`,
      { isPlaying: false, positionMs: 0, providerTrackId: null, trackEnded: true },
      asAdmin(CONSOLE_TOKEN),
    );
    expect(res.nowPlaying).not.toBeNull();
    expect(res.nowPlaying?.status).toBe('playing');

    const snapshot = await api.get<QueueSnapshot>(ctx, `/api/venues/${state.venueId}/queue`);
    expect(snapshot.nowPlaying?.queueItemId).toBe(res.nowPlaying?.queueItemId);
  });

  it('a second advance completes the playing song (played transition)', async () => {
    const before = await api.get<QueueSnapshot>(ctx, `/api/venues/${state.venueId}/queue`);
    const wasPlaying = before.nowPlaying?.queueItemId;
    expect(wasPlaying).toBeTruthy();

    const res = await api.post<{ nowPlaying: QueueItem | null }>(
      ctx,
      `/api/venues/${state.venueId}/playback/state`,
      { isPlaying: false, positionMs: 0, providerTrackId: null, trackEnded: true },
      asAdmin(CONSOLE_TOKEN),
    );
    // The previous song reached a terminal state and a different item took over.
    expect(res.nowPlaying?.queueItemId).not.toBe(wasPlaying);
  });

  it('credits Reputation v2 to the requester when their song plays', async () => {
    // Regression: recordSongPlayed was silently dropped by registerQueueRoutes,
    // which only forwards the seams it explicitly enumerates. Nothing failed —
    // the counter just never moved — so assert the persisted effect directly.
    const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
    try {
      const { rows } = await pool.query<{ songs_played: number; reputation_score: string }>(
        'select songs_played, reputation_score from users where songs_played > 0',
      );
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0]!.songs_played).toBeGreaterThan(0);
      // DEFAULT_REPUTATION_WEIGHTS.songPlayed is +3 per played song.
      expect(Number(rows[0]!.reputation_score)).toBeGreaterThan(0);
    } finally {
      await pool.end();
    }
  });

  it('rejects a playback report without the console token', async () => {
    await expect(
      api.post(ctx, `/api/venues/${state.venueId}/playback/state`, {
        isPlaying: false,
        positionMs: 0,
        providerTrackId: null,
      }),
    ).rejects.toMatchObject({ status: 401 });
  });
});

describe('crowd skip', () => {
  it('tallies votes, blocks double-voting, and actually skips at the threshold', async () => {
    const snapshot = await api.get<QueueSnapshot>(ctx, `/api/venues/${state.venueId}/queue`);
    const playingId = snapshot.nowPlaying?.queueItemId;
    expect(playingId).toBeTruthy();

    // Fresh venue => 3 active users => threshold is max(3, ceil(0.5 * 3)) = 3,
    // so all three patrons voting is exactly enough to trigger the skip.
    const first = await api.post<{ crowdSkipVotes: number }>(
      ctx,
      `/api/queue-items/${playingId}/skip-vote`,
      {},
      asSession(state.patrons[0]!.sessionId),
    );
    expect(first.crowdSkipVotes).toBe(1);

    // The per-user guard must be checked while the item is still playing —
    // once the threshold skips it, further votes fail validation instead.
    await expect(
      api.post(
        ctx,
        `/api/queue-items/${playingId}/skip-vote`,
        {},
        asSession(state.patrons[0]!.sessionId),
      ),
    ).rejects.toMatchObject({ code: 'already_skip_voted' });

    let lastTally = first.crowdSkipVotes;
    for (const p of state.patrons.slice(1)) {
      const res = await api.post<{ crowdSkipVotes: number }>(
        ctx,
        `/api/queue-items/${playingId}/skip-vote`,
        {},
        asSession(p.sessionId),
      );
      lastTally = res.crowdSkipVotes;
    }
    expect(lastTally).toBe(3);

    // The song must actually be gone from now-playing once the threshold is hit.
    const after = await api.get<QueueSnapshot>(ctx, `/api/venues/${state.venueId}/queue`);
    expect(after.nowPlaying?.queueItemId).not.toBe(playingId);
  });
});

describe('venue controls', () => {
  it('activates Power Hour and surfaces it on the public venue read', async () => {
    const res = await api.post<{ powerHour: { genre: string; multiplier: number } }>(
      ctx,
      `/api/venues/${state.venueId}/power-hour`,
      { genre: 'hip-hop', multiplier: 2, durationMinutes: 15 },
      asAdmin(state.ownerToken),
    );
    expect(res.powerHour.genre).toBe('hip-hop');

    const venue = await api.get<{ powerHour: { genre: string } | null }>(
      ctx,
      `/api/venues/${state.venueId}`,
    );
    expect(venue.powerHour?.genre).toBe('hip-hop');
  });

  it('requires admin auth for venue controls', async () => {
    await expect(
      api.post(ctx, `/api/venues/${state.venueId}/power-hour`, {
        genre: 'pop',
        multiplier: 2,
        durationMinutes: 15,
      }),
    ).rejects.toMatchObject({ status: 401 });
  });
});

describe('boost codes', () => {
  it('generates, redeems once, and refuses a second redemption', async () => {
    const generated = await api.post<{ boostCode?: { code: string }; code?: string }>(
      ctx,
      `/api/venues/${state.venueId}/boost-codes`,
      { tier: 'cocktail' },
      asAdmin(state.ownerToken),
    );
    const code = generated.boostCode?.code ?? generated.code;
    expect(code).toBeTruthy();

    const redeemed = await api.post<{ creditBalance: number }>(
      ctx,
      '/api/boost-codes/redeem',
      { code },
      { ...asUser(state.patrons[1]!.userId), ...idempotent() },
    );
    // 'cocktail' tier is worth 2 credits (BOOST_CODE_TIER_CREDITS).
    expect(redeemed.creditBalance).toBe(2);

    await expect(
      api.post(
        ctx,
        '/api/boost-codes/redeem',
        { code },
        { ...asUser(state.patrons[2]!.userId), ...idempotent() },
      ),
    ).rejects.toMatchObject({ code: 'boost_code_already_redeemed' });
  });

  it('rejects an unknown code', async () => {
    await expect(
      api.post(
        ctx,
        '/api/boost-codes/redeem',
        { code: 'ZZZZ-ZZZZ' },
        { ...asUser(state.patrons[2]!.userId), ...idempotent() },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});

// ---------------------------------------------------------------------------
// Issue #97: sessions.active_request_count was increment-only and never
// decremented, so a patron who cycled through MAX_ACTIVE_REQUESTS_PER_USER (3)
// requests was blocked forever — even after every one of those songs had
// finished playing. This is a STATEFUL bug: it only shows up after a full
// request -> terminal-status cycle, which is exactly why the rest of this
// suite (each patron requests once) and the unit suite (fresh state per test)
// both missed it. Uses its own venue + patron so it doesn't depend on, or
// disturb, the ordered state above.
// ---------------------------------------------------------------------------
describe('issue #97: active-request count unblocks once requests go terminal', () => {
  const s = {
    ownerToken: '',
    venueId: '',
    qrToken: '',
    session: { sessionId: '', userId: '' },
    items: [] as string[],
  };

  /**
   * The request-cooldown (2 minutes, unrelated to this bug) would otherwise force
   * this test to sleep for several real minutes between requests. Reset it directly
   * via SQL so the test exercises the eligibility path under test — the derived
   * active-request count — without also becoming a slow clock test.
   */
  async function clearCooldown(sessionId: string): Promise<void> {
    const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
    try {
      await pool.query(
        `update sessions
           set cooldown_ends_at = now() - interval '1 hour',
               last_request_at = now() - interval '1 hour'
         where session_id = $1`,
        [sessionId],
      );
    } finally {
      await pool.end();
    }
  }

  it('sets up a fresh venue and a single patron', async () => {
    const signup = await api.post<{ token: string }>(ctx, '/api/venue-owners/signup', {
      email: `integration-97-${randomUUID()}@example.test`,
      password: 'integration-password',
      displayName: 'Issue 97 Owner',
    });
    s.ownerToken = signup.token;

    const created = await api.post<{ venue: { venueId: string; qrToken: string } }>(
      ctx,
      '/api/venues',
      { name: 'Issue 97 Venue', musicProvider: 'spotify' },
      asAdmin(s.ownerToken),
    );
    s.venueId = created.venue.venueId;
    s.qrToken = created.venue.qrToken;

    const joined = await api.post<{ session: { sessionId: string; userId: string } }>(
      ctx,
      '/api/sessions/join',
      { venueQrToken: s.qrToken },
    );
    s.session = joined.session;
  });

  it('blocks a 4th request once the patron has 3 live (queued) requests', async () => {
    for (let i = 0; i < 3; i += 1) {
      if (i > 0) await clearCooldown(s.session.sessionId);
      const res = await api.post<{ queueItem: QueueItem }>(
        ctx,
        `/api/venues/${s.venueId}/requests`,
        { providerTrackId: FAKE_TRACKS[i] },
        asSession(s.session.sessionId),
      );
      expect(res.queueItem.status).toBe('queued');
      s.items.push(res.queueItem.queueItemId);
    }
    expect(s.items).toHaveLength(3);

    await clearCooldown(s.session.sessionId);
    await expect(
      api.post(
        ctx,
        `/api/venues/${s.venueId}/requests`,
        { providerTrackId: FAKE_TRACKS[3] },
        asSession(s.session.sessionId),
      ),
    ).rejects.toMatchObject({ code: 'max_active_requests' });
  });

  it('drives all 3 requests to a terminal status via real advance() calls', async () => {
    // Each advance() call finishes whatever is currently playing (-> 'played') and
    // starts the next queued item, so items.length + 1 calls exhausts every item
    // this patron requested to a terminal status.
    for (let i = 0; i <= s.items.length; i += 1) {
      await api.post(
        ctx,
        `/api/venues/${s.venueId}/playback/state`,
        { isPlaying: false, positionMs: 0, providerTrackId: null, trackEnded: true },
        asAdmin(CONSOLE_TOKEN),
      );
    }

    const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
    try {
      const { rows } = await pool.query<{ status: string }>(
        `select status from queue_items where queue_item_id = any($1::uuid[])`,
        [s.items],
      );
      expect(rows).toHaveLength(3);
      expect(rows.every((r) => r.status === 'played')).toBe(true);
    } finally {
      await pool.end();
    }
  });

  it('THE REGRESSION: allows a 4th request now that all 3 prior ones are terminal', async () => {
    await clearCooldown(s.session.sessionId);
    const res = await api.post<{ queueItem: QueueItem }>(
      ctx,
      `/api/venues/${s.venueId}/requests`,
      { providerTrackId: FAKE_TRACKS[3] },
      asSession(s.session.sessionId),
    );
    expect(res.queueItem.status).toBe('queued');
  });
});
