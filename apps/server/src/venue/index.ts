/**
 * WS4 — venue controls (control modes, blocks, overrides, anthem,
 * announcements). See SPEC.md §1 layer 4 (Overrides) and §5 "Venue control"
 * + "Announcements". Registers routes for the venue-admin endpoints listed
 * in CONTRACTS.md; auth is a provisional token guard (see auth.ts).
 *
 * apps/server/src/index.ts is off-limits to this workstream — the
 * maintainer wires `app.register(registerVenueRoutes, opts)` at merge time,
 * supplying the real `queueControl` (WS3), `broadcaster` (WS1 realtime/),
 * and `resolveMusicProvider` (WS2 providers/) implementations. Until then,
 * safe no-op fallbacks let this plugin register standalone for local/dev
 * use and tests.
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { QueueItem } from '@openaux/shared';
import { pool } from '../db.js';
import { PostgresAnalyticsSink } from './analytics.js';
import { registerAnthemRoute } from './anthem.js';
import { createAnnouncementsService } from './announcements.js';
import { registerApprovalsRoute } from './approvals.js';
import {
  EnvAdminTokenProvider,
  createVenueAdminGuard,
  type AdminTokenProvider,
  type VenueAdminVerify,
} from './auth.js';
import { PostgresBoostCodeRepository } from './boost-code-repository.js';
import { registerBoostCodesRoutes } from './boost-codes.js';
import { registerFallbackPlaylistRoute } from './fallback-playlist.js';
import { registerOverridesRoute } from './overrides.js';
import { registerPowerHourRoute } from './power-hour.js';
import { PostgresVenueRepository } from './repository.js';
import { registerSettingsRoute } from './settings.js';
import { registerSkipRoute } from './skip.js';
import { registerVenueReadRoutes } from './venue-read.js';
import type {
  AnalyticsSink,
  BoostCodeRepository,
  Broadcaster,
  MusicProviderResolver,
  QueueControl,
  VenueRepository,
} from './types.js';

export type {
  AnalyticsSink,
  AnthemConfig,
  BoostCodeRepository,
  Broadcaster,
  MusicProviderResolver,
  PowerHourRecord,
  QueueControl,
  VenueRepository,
  VenueRouteContext,
  VenueSettingsRecord,
} from './types.js';
export type { AnnouncementsService } from './announcements.js';
export type { AdminTokenProvider } from './auth.js';

export interface VenueRoutesOptions {
  repository?: VenueRepository;
  boostCodeRepository?: BoostCodeRepository;
  analytics?: AnalyticsSink;
  /** WS3 seam — see types.ts QueueControl doc. TODO: maintainer must inject the real engine. */
  queueControl?: QueueControl;
  /** WS1 realtime/ owns the concrete broadcastToVenue implementation. */
  broadcaster?: Broadcaster;
  /** WS2 providers/ owns concrete MusicProvider implementations. Required for overrides/anthem. */
  resolveMusicProvider?: MusicProviderResolver;
  adminTokenProvider?: AdminTokenProvider;
  /** Owner-session verifier from venue-auth; authoritative when provided. */
  adminVerify?: VenueAdminVerify;
}

const noopQueueControl: QueueControl = {
  async insertOverride() {
    // TODO(WS3): inject a real QueueControl at registration time.
  },
  async skipCurrent() {
    // TODO(WS3): inject a real QueueControl at registration time.
  },
};

const noopBroadcaster: Broadcaster = {
  broadcastToVenue() {
    // TODO(WS1): inject the realtime broadcaster at registration time.
  },
};

export const registerVenueRoutes: FastifyPluginAsync<VenueRoutesOptions> = async (
  app: FastifyInstance,
  opts: VenueRoutesOptions,
) => {
  const repository = opts.repository ?? new PostgresVenueRepository(pool);
  const boostCodeRepository = opts.boostCodeRepository ?? new PostgresBoostCodeRepository(pool);
  const analytics = opts.analytics ?? new PostgresAnalyticsSink(pool);
  const queueControl = opts.queueControl ?? noopQueueControl;
  const broadcaster = opts.broadcaster ?? noopBroadcaster;
  const adminGuard = createVenueAdminGuard(
    opts.adminTokenProvider ?? new EnvAdminTokenProvider(),
    opts.adminVerify,
  );

  const ctx = {
    repository,
    boostCodeRepository,
    analytics,
    queueControl,
    broadcaster,
    resolveMusicProvider: opts.resolveMusicProvider,
    adminGuard,
  };

  registerVenueReadRoutes(app, ctx);
  registerSettingsRoute(app, ctx);
  registerOverridesRoute(app, ctx);
  registerApprovalsRoute(app, ctx);
  registerSkipRoute(app, ctx);
  registerFallbackPlaylistRoute(app, ctx);
  registerAnthemRoute(app, ctx);
  registerPowerHourRoute(app, ctx);
  registerBoostCodesRoutes(app, ctx);
};

/**
 * notifyNowPlaying hook factory for the queue engine (WS3).
 *
 * Fastify decorators added inside a registered plugin are scoped to that
 * plugin's encapsulation context and are NOT visible on the parent
 * FastifyInstance the maintainer holds in apps/server/src/index.ts — so
 * this is exported as a plain factory instead of `app.decorate(...)`.
 * WS3 should call `createVenueAnnouncementsService({ broadcaster })` once
 * at startup (with the real realtime broadcaster) and invoke
 * `.notifyNowPlaying(queueItem)` whenever a queue_items row transitions to
 * status = 'playing'.
 */
export function createVenueAnnouncementsService(opts: {
  repository?: VenueRepository;
  broadcaster: Broadcaster;
}): { notifyNowPlaying(queueItem: QueueItem): Promise<void> } {
  const repository = opts.repository ?? new PostgresVenueRepository(pool);
  return createAnnouncementsService({ repository, broadcaster: opts.broadcaster });
}
