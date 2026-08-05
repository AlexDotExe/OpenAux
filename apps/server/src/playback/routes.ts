/**
 * registerPlaybackRoutes — Fastify plugin for the console-authenticated
 * playback-state report:
 *
 *   POST /api/venues/:venueId/playback/state  (ReportPlaybackStateRequest/Response)
 *
 * The venue console (Apple Music venues) or the Spotify poller's client reports
 * current playback state here. This route:
 *   1. updates the in-memory per-venue NowPlaying cache (PlaybackStateStore),
 *   2. resolves the pending playback command whose commandId was echoed back
 *      (RealtimePlaybackBridge.resolveCommand), and
 *   3. when trackEnded is true, calls the injected onTrackEnded(venueId) — the
 *      maintainer wires this to WS3's queue-advance — and returns the item now
 *      playing.
 *
 * GET .../playback/devices and PUT .../playback/device are ANOTHER workstream's
 * scope and are intentionally not registered here.
 *
 * apps/server/src/index.ts is off-limits: the maintainer registers this plugin
 * and injects onTrackEnded + the bridge's resolveCommand/stateStore at merge time.
 * Safe defaults let it register standalone for tests/local dev.
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type {
  ApiError,
  ApiErrorCode,
  QueueItem,
  ReportPlaybackStateRequest,
  ReportPlaybackStateResponse,
  VenueId,
} from '@openaux/shared';
import { EnvConsoleTokenProvider, createConsoleGuard, type ConsoleTokenProvider } from './auth.js';
import { PlaybackStateStore } from './state.js';

function errorResponse(code: ApiErrorCode, message: string): ApiError {
  return { error: { code, message } };
}

export interface PlaybackRoutesOptions {
  /**
   * Called when a state report has trackEnded=true. The maintainer wires this
   * to WS3's queue advance. Default is a throws-safe noop returning null.
   */
  onTrackEnded?: (venueId: VenueId) => Promise<QueueItem | null>;
  /** Bridge hook: resolve the pending command whose commandId was echoed back. */
  resolveCommand?: (commandId: string) => boolean;
  /** Shared NowPlaying cache — pass the bridge's store so getNowPlaying stays in sync. */
  stateStore?: PlaybackStateStore;
  /** Console token verification. Defaults to the VENUE_ADMIN_TOKEN env var. */
  consoleTokenProvider?: ConsoleTokenProvider;
}

const defaultOnTrackEnded = async (): Promise<QueueItem | null> => null;

function isValidBody(body: unknown): body is ReportPlaybackStateRequest {
  if (typeof body !== 'object' || body === null) return false;
  const b = body as Record<string, unknown>;
  if (typeof b.isPlaying !== 'boolean') return false;
  if (typeof b.positionMs !== 'number' || !Number.isFinite(b.positionMs)) return false;
  if (b.providerTrackId !== null && typeof b.providerTrackId !== 'string') return false;
  if (b.trackEnded !== undefined && typeof b.trackEnded !== 'boolean') return false;
  if (b.commandId !== undefined && typeof b.commandId !== 'string') return false;
  return true;
}

export const registerPlaybackRoutes: FastifyPluginAsync<PlaybackRoutesOptions> = async (
  app: FastifyInstance,
  opts: PlaybackRoutesOptions,
) => {
  const onTrackEnded = opts.onTrackEnded ?? defaultOnTrackEnded;
  const resolveCommand = opts.resolveCommand ?? (() => false);
  const stateStore = opts.stateStore ?? new PlaybackStateStore();
  const consoleGuard = createConsoleGuard(
    opts.consoleTokenProvider ?? new EnvConsoleTokenProvider(),
  );

  app.post<{ Params: { venueId: string }; Body: ReportPlaybackStateRequest }>(
    '/api/venues/:venueId/playback/state',
    { preHandler: consoleGuard },
    async (request, reply) => {
      const { venueId } = request.params;
      if (!isValidBody(request.body)) {
        return reply.code(400).send(errorResponse('validation', 'invalid playback state report'));
      }
      const { isPlaying, positionMs, providerTrackId, trackEnded, commandId } = request.body;

      stateStore.record(venueId, { providerTrackId, positionMs, isPlaying });

      if (commandId) resolveCommand(commandId);

      let nowPlaying: QueueItem | null = null;
      if (trackEnded) {
        nowPlaying = await onTrackEnded(venueId);
      }

      const response: ReportPlaybackStateResponse = { acknowledged: true, nowPlaying };
      return reply.send(response);
    },
  );
};
