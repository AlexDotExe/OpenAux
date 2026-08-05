/**
 * Injection seams — the interfaces other workstreams implement so the queue core
 * stays decoupled (SPEC.md §1). Each has a safe default so the plugin can register
 * standalone; the maintainer injects the real implementations at wire-up time.
 *
 * - FrictionProvider        → WS6 (antispam). Default: zeros.
 * - Broadcaster             → WS1 (realtime). Default: noop.
 * - EmitAnalyticsEvent      → WS6 (analytics). Default: noop (never blocks the queue).
 * - MusicProviderResolver   → WS2 (providers). Default: throws (must be injected to play).
 * - Clock                   → deterministic time in tests. Default: system clock.
 */

import type {
  AnalyticsEventType,
  MusicProvider,
  PlaybackTarget,
  QueueItemId,
  RealtimeEvent,
  UserId,
  VenueId,
} from '@openaux/shared';

// ---------------------------------------------------------------------------
// Friction (anti-spam) — WS6
// ---------------------------------------------------------------------------

/** Per-item friction terms fed into the scoring engine (never computed here). */
export interface FrictionInputs {
  artistRepeatPenalty: number;
  spamPenalty: number;
}

export const ZERO_FRICTION: FrictionInputs = { artistRepeatPenalty: 0, spamPenalty: 0 };

export interface FrictionRequestItem {
  queueItemId: QueueItemId;
  artist: string;
  requestingUserId: UserId;
}

export interface FrictionRequest {
  venueId: VenueId;
  items: FrictionRequestItem[];
}

export interface FrictionProvider {
  /** Returns friction per queue item. Missing entries are treated as zero. */
  getFriction(request: FrictionRequest): Promise<Map<QueueItemId, FrictionInputs>>;
}

/** Default: no friction. WS6 replaces this. */
export const zeroFrictionProvider: FrictionProvider = {
  async getFriction() {
    return new Map();
  },
};

// ---------------------------------------------------------------------------
// Realtime broadcast — WS1
// ---------------------------------------------------------------------------

export interface Broadcaster {
  broadcastToVenue(venueId: VenueId, event: RealtimeEvent): void;
}

export const noopBroadcaster: Broadcaster = {
  broadcastToVenue() {
    /* no-op default */
  },
};

// ---------------------------------------------------------------------------
// Analytics — WS6 (async, must never block queue operations)
// ---------------------------------------------------------------------------

export interface AnalyticsEventInput {
  eventType: AnalyticsEventType;
  venueId: string;
  actorUserId?: string | null;
  queueItemId?: string | null;
  metadata?: Record<string, unknown>;
}

export type EmitAnalyticsEvent = (event: AnalyticsEventInput) => void;

export const noopEmitAnalyticsEvent: EmitAnalyticsEvent = () => {
  /* no-op default */
};

// ---------------------------------------------------------------------------
// Music provider access — WS2 (only providers/ may touch concrete SDKs)
// ---------------------------------------------------------------------------

export interface MusicProviderResolver {
  /** The venue's configured provider (search / metadata / playback commands). */
  getProvider(venueId: VenueId): Promise<MusicProvider>;
  /** Opaque handle to the venue's playback device. */
  getPlaybackTarget(venueId: VenueId): Promise<PlaybackTarget>;
}

/** Default: refuses. A real resolver must be injected before requests/playback work. */
export const unavailableProviderResolver: MusicProviderResolver = {
  async getProvider() {
    throw new Error('MusicProviderResolver not injected (WS2). Cannot resolve venue provider.');
  },
  async getPlaybackTarget() {
    throw new Error('MusicProviderResolver not injected (WS2). Cannot resolve playback target.');
  },
};

// ---------------------------------------------------------------------------
// Clock — deterministic time for tests
// ---------------------------------------------------------------------------

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};
