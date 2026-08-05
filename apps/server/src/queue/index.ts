/**
 * WS3 queue core — public entry point.
 *
 * `registerQueueRoutes` is the Fastify plugin the maintainer wires into the server.
 * Inject the seams other workstreams own via `opts`; each has a safe default so the
 * plugin registers standalone (see seams.ts):
 *   - frictionProvider   → WS6 (default: zeros)
 *   - broadcaster        → WS1 (default: noop)
 *   - emitAnalyticsEvent → WS6 (default: noop)
 *   - providerResolver   → WS2 (default: throws — must be injected to play audio)
 * The `repository` defaults to a Postgres implementation over the shared pool.
 *
 * The DJ brain (`QueueService.advance`) is exported via `createQueueService` so the
 * playback loop and WS4's skip endpoint can advance the queue programmatically.
 *
 * `registerQueueRoutes` returns the `QueueService` instance it wired up (or, if
 * `options.service` is supplied, that same instance) — see `RegisterQueueRoutesOptions`
 * below for why, and the exact migration for the composition root.
 */

import type { FastifyInstance } from 'fastify';
import { pool } from '../db.js';
import { PostgresQueueRepository, type QueueRepository } from './repository.js';
import { registerQueueRouteHandlers } from './routes.js';
import { createQueueService, QueueService } from './service.js';
import type {
  Broadcaster,
  Clock,
  EmitAnalyticsEvent,
  FrictionProvider,
  MusicProviderResolver,
} from './seams.js';

export interface RegisterQueueRoutesOptions {
  repository?: QueueRepository;
  frictionProvider?: FrictionProvider;
  broadcaster?: Broadcaster;
  emitAnalyticsEvent?: EmitAnalyticsEvent;
  providerResolver?: MusicProviderResolver;
  clock?: Clock;
  /**
   * Pre-built service to register routes with, instead of constructing a new one from
   * the seam options above. Use this when the composition root also needs the service
   * for programmatic calls (playback loop, venue overrides/skip) — build it once with
   * `createQueueService`, pass it here, and use the same reference for both. When
   * omitted (the existing call shape), a service is still built internally and returned,
   * so this addition is fully backward compatible.
   */
  service?: QueueService;
}

/**
 * Fastify plugin: registers the queue-core REST endpoints and returns the `QueueService`
 * instance backing them, so callers no longer need to build a second, duplicate service
 * over the same repository just to reach `advance` / `playNow` / `playNext`
 * programmatically (e.g. WS4's QueueControl seam). Existing callers that ignore the
 * return value (`registerQueueRoutes(app, opts);`) are unaffected.
 */
export function registerQueueRoutes(
  app: FastifyInstance,
  options: RegisterQueueRoutesOptions = {},
): QueueService {
  const repository = options.repository ?? new PostgresQueueRepository(pool);
  const service =
    options.service ??
    createQueueService({
      repository,
      frictionProvider: options.frictionProvider,
      broadcaster: options.broadcaster,
      emitAnalyticsEvent: options.emitAnalyticsEvent,
      providerResolver: options.providerResolver,
      clock: options.clock,
    });
  registerQueueRouteHandlers(app, service, repository);
  return service;
}

// Re-exports for other workstreams and tests.
export { QueueService, createQueueService } from './service.js';
export { PostgresQueueRepository } from './repository.js';
export type { QueueRepository, VenueConfig, InsertQueueItemInput } from './repository.js';
export { QueueError, statusForCode } from './errors.js';
export * from './seams.js';
export * from './eligibility.js';
export * from './votes.js';
export * from './ranking.js';
export * from './dj-brain.js';
export * from './snapshot.js';
export * from './constants.js';

// Keep a reference so downstream imports of the type stay stable.
export type QueueServiceType = QueueService;
