/**
 * Composition root. The workstream folders own their logic behind route-module
 * factories and injectable seams (see CLAUDE.md ownership map); this file wires
 * the real implementations together and starts the server. No business logic
 * lives here — only construction + the thin cross-module adapters the seams need.
 *
 * The pg pool (db.ts) connects lazily on first query, so importing/constructing
 * repositories here performs no I/O; the server boots without a live Postgres.
 */
import Fastify from 'fastify';
import type {
  AnalyticsEventType,
  MusicProvider,
  MusicProviderId,
  PlaybackTarget,
  RealtimeEvent,
} from '@openaux/shared';

import { pool } from './db.js';
import { emitAnalyticsEvent } from './analytics/index.js';
import {
  broadcastToVenue,
  registerRealtime,
  sendSessionExpired,
  sendToConsole,
} from './realtime/index.js';
import { PgSessionRepository, registerSessionRoutes } from './sessions/index.js';
import type { AnalyticsEventEmitter } from './sessions/index.js';
import { PostgresQueueRepository, registerQueueRoutes } from './queue/index.js';
import type {
  Broadcaster as QueueBroadcaster,
  EmitAnalyticsEvent,
  FrictionProvider as QueueFrictionProvider,
  MusicProviderResolver as QueueMusicProviderResolver,
} from './queue/index.js';
import { createVenueAnnouncementsService, registerVenueRoutes } from './venue/index.js';
import type { AnalyticsSink as VenueAnalyticsSink, QueueControl } from './venue/index.js';
import { createPaymentsService, registerPaymentRoutes } from './payments/index.js';
import {
  createPgFrictionProvider,
  createPgSessionRepository,
  startAntispamSweeper,
} from './antispam/index.js';
import {
  InMemoryVenueTokenStore,
  PgVenueTokenStore,
  TokenCipher,
  getProvider,
  loadEncryptionKey,
  registerProviderAuthRoutes,
} from './providers/index.js';
import type { VenueTokenStore } from './providers/index.js';
import { RealtimePlaybackBridge, registerPlaybackRoutes } from './playback/index.js';
import {
  PgVenueAuthRepository,
  createVenueAdminVerifier,
  registerVenueAuthRoutes,
} from './venue-auth/index.js';

const app = Fastify({ logger: true });

app.get('/health', async () => ({ ok: true, service: 'openaux-server' }));

async function main(): Promise<void> {
  // --- Venue-owner accounts: one owner-session bearer token authorizes every
  // venue-admin surface (console routes, Spotify linking, console WebSocket). The
  // verifier also honors the legacy VENUE_ADMIN_TOKEN as a migration fallback.
  const venueAuthRepository = new PgVenueAuthRepository(pool);
  const venueAdminVerifier = createVenueAdminVerifier({ repository: venueAuthRepository });

  // --- WS1 realtime channel: WS /ws/venues/:venueId (broadcast + per-session push) ---
  registerRealtime(app, {
    consoleVerify: (venueId, token) => venueAdminVerifier.verifyVenueAdmin(venueId, token),
  });

  // --- Shared singletons (no I/O on construction) ---
  // Spotify venue tokens are encrypted at rest when TOKEN_ENCRYPTION_KEY is set;
  // without it we fall back to the in-memory stub (dev only — OAuth linking and
  // Connect playback won't persist). Guarding here keeps the server booting with
  // no env configured (the /health smoke test path).
  const encryptionKeyRaw = process.env.TOKEN_ENCRYPTION_KEY;
  let venueTokenStore: VenueTokenStore;
  if (encryptionKeyRaw) {
    venueTokenStore = new PgVenueTokenStore(
      pool,
      new TokenCipher(loadEncryptionKey(encryptionKeyRaw)),
    );
  } else {
    app.log.warn('TOKEN_ENCRYPTION_KEY unset — using in-memory venue token store (dev only).');
    venueTokenStore = new InMemoryVenueTokenStore();
  }

  const queueRepository = new PostgresQueueRepository(pool);

  // Apple Music has no server-side playback API: the bridge relays play/queue/skip
  // commands over the realtime channel to MusicKit JS in the venue console. Spotify
  // venues ignore it (the server drives Spotify Connect directly).
  const playbackBridge = new RealtimePlaybackBridge({ sendToConsole });

  // WS6 friction is per-item ({venueId, artist, supporterUserIds}); the queue seam
  // wants a batch call returning a Map keyed by queueItemId. Adapt between them.
  const antispamFriction = createPgFrictionProvider(pool);
  const frictionProvider: QueueFrictionProvider = {
    async getFriction(request) {
      const entries = await Promise.all(
        request.items.map(async (item) => {
          const scores = await antispamFriction.getFriction({
            venueId: request.venueId,
            artist: item.artist,
            supporterUserIds: [item.requestingUserId],
          });
          return [item.queueItemId, scores] as const;
        }),
      );
      return new Map(entries);
    },
  };

  // Sessions emit through the WS6 analytics pipeline (fire-and-forget).
  const analyticsEmitter: AnalyticsEventEmitter = { emitAnalyticsEvent };

  // WS5 settlement service — shared by the payment routes and the cross-module
  // terminal-state glue below.
  const paymentsService = createPaymentsService(app);

  // WS4 announcements — dj_attribution + anthem_won over the realtime channel.
  const announcements = createVenueAnnouncementsService({
    broadcaster: { broadcastToVenue },
  });

  // Queue broadcaster: fan out over realtime AND fire venue announcements whenever
  // an item starts playing (now_playing_changed carrying a queueItem). This is the
  // seam that connects WS3's playback advance to WS4's announcements over WS1.
  const queueBroadcaster: QueueBroadcaster = {
    broadcastToVenue(venueId, event: RealtimeEvent) {
      broadcastToVenue(venueId, event);
      if (event.type === 'now_playing_changed' && event.payload.queueItem) {
        void announcements.notifyNowPlaying(event.payload.queueItem);
      }
    },
  };

  // Queue analytics seam: forward to the pipeline and settle boosted items that
  // reach a refundable terminal state via the queue-advance skip path (D14).
  const queueEmit: EmitAnalyticsEvent = (event) => {
    emitAnalyticsEvent(event);
    if (event.eventType === 'song_skipped' && event.queueItemId) {
      void paymentsService.settleQueueItem(event.queueItemId, 'skipped');
    }
  };

  // WS2 provider resolution. The queue engine needs a provider + playback target
  // per venue; venue overrides/anthem need a provider by provider id. One shared
  // in-memory venue token store for now (real OAuth-linked tokens are a gap).
  const queueProviderResolver: QueueMusicProviderResolver = {
    async getProvider(venueId): Promise<MusicProvider> {
      const venue = await queueRepository.getVenueConfig(venueId);
      if (!venue) throw new Error(`No venue config for ${venueId}`);
      return getProvider(
        { musicProvider: venue.musicProvider },
        { venueTokenStore, playbackBridge },
      );
    },
    async getPlaybackTarget(venueId): Promise<PlaybackTarget> {
      // Prefer the Connect device the venue picked (venues.playback_device_id);
      // fall back to a process-wide env default for single-venue dev setups.
      const { rows } = await pool.query<{ playback_device_id: string | null }>(
        'select playback_device_id from venues where venue_id = $1',
        [venueId],
      );
      const deviceId = rows[0]?.playback_device_id ?? process.env.PLAYBACK_DEVICE_ID ?? '';
      return { venueId, providerDeviceId: deviceId };
    },
  };
  const resolveVenueProvider = (providerId: MusicProviderId): MusicProvider =>
    getProvider({ musicProvider: providerId }, { venueTokenStore, playbackBridge });

  // Seams shared by the queue routes' internal service and the standalone service
  // used for programmatic advance (skip/override). Both are stateless over the
  // same repository, so two instances are equivalent.
  const queueOptions = {
    repository: queueRepository,
    frictionProvider,
    broadcaster: queueBroadcaster,
    emitAnalyticsEvent: queueEmit,
    providerResolver: queueProviderResolver,
  };

  // --- WS1 sessions ---
  registerSessionRoutes(app, {
    repository: new PgSessionRepository(),
    analytics: analyticsEmitter,
  });

  // --- WS3 queue core (requests, votes, snapshot, position) ---
  // Single service instance: the routes and the programmatic override/skip glue
  // below share it (the plugin returns the very service it registered).
  const queueService = registerQueueRoutes(app, queueOptions);

  // QueueControl (WS4 → WS3): the venue route has already written the override row;
  // this drives actual playback to the specific item (precise now/next routing).
  const queueControl: QueueControl = {
    async insertOverride({ queueItemId, when }) {
      if (when === 'now') await queueService.playNow(queueItemId);
      else await queueService.playNext(queueItemId);
    },
    async skipCurrent(venueId) {
      await queueService.advance({ venueId, reason: 'skipped' });
    },
  };

  // Venue analytics sink: forward to the pipeline and settle on a venue-initiated
  // skip (the venue route emits 'song_skipped' here rather than via the queue seam).
  const venueAnalytics: VenueAnalyticsSink = {
    record(event) {
      emitAnalyticsEvent({
        eventType: event.eventType as AnalyticsEventType,
        venueId: event.venueId,
        actorUserId: event.actorUserId ?? null,
        queueItemId: event.queueItemId ?? null,
        metadata: event.metadata,
      });
      if (event.eventType === 'song_skipped' && event.queueItemId) {
        void paymentsService.settleQueueItem(event.queueItemId, 'skipped');
      }
    },
  };

  // --- Venue-owner accounts: signup, login, me, and venue creation (POST /api/venues) ---
  await app.register(registerVenueAuthRoutes, {
    repository: venueAuthRepository,
    verifier: venueAdminVerifier,
  });

  // --- WS4 venue controls (settings, overrides, approvals, skip, fallback, anthem, reads) ---
  await registerVenueRoutes(app, {
    analytics: venueAnalytics,
    queueControl,
    broadcaster: { broadcastToVenue },
    resolveMusicProvider: resolveVenueProvider,
    adminVerify: (venueId, token) => venueAdminVerifier.verifyVenueAdmin(venueId, token),
  });

  // --- WS5 payments (credits purchase, boosts) ---
  await registerPaymentRoutes(app, { service: paymentsService });

  // --- Playback loop: console reports state, and trackEnded advances the queue.
  // Apple venues drive playback via the bridge (over the console WS); the bridge's
  // state store is shared so getNowPlaying reflects what the console reported.
  await app.register(registerPlaybackRoutes, {
    onTrackEnded: async (venueId) => {
      const { nowPlaying } = await queueService.advance({ venueId, reason: 'ended' });
      return nowPlaying;
    },
    resolveCommand: (commandId) => playbackBridge.resolveCommand(commandId),
    stateStore: playbackBridge.store,
  });

  // --- Spotify OAuth linking + Connect device selection. Only mounted when an
  // encryption key exists (the routes construct a TokenCipher eagerly); without
  // it, Spotify account linking is simply unavailable rather than crashing boot.
  if (encryptionKeyRaw) {
    await app.register(registerProviderAuthRoutes, {
      adminVerify: (venueId, token) => venueAdminVerifier.verifyVenueAdmin(venueId, token),
    });
  } else {
    app.log.warn('TOKEN_ENCRYPTION_KEY unset — Spotify linking routes not mounted.');
  }

  // --- WS6 antispam sweeper: on expiry, emit analytics AND push SessionExpiredEvent
  // to that session's realtime connection.
  startAntispamSweeper({
    sessionRepository: createPgSessionRepository(pool),
    emitEvent: (event) => {
      emitAnalyticsEvent(event);
      if (event.eventType === 'user_session_expired') {
        const sessionId = event.metadata?.sessionId;
        if (typeof sessionId === 'string') {
          sendSessionExpired(sessionId, { type: 'session_expired', payload: { sessionId } });
        }
      }
    },
    onError: (err) => app.log.error(err),
  });

  const port = Number(process.env.PORT ?? 4000);
  await app.listen({ port, host: '0.0.0.0' });
}

main().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
