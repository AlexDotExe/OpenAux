/**
 * Internal types for the provider adapters (WS2). Nothing here is exported
 * through @openaux/shared — code outside this folder must only ever see the
 * MusicProvider interface itself.
 */
import type { NowPlayingState, PlaybackTarget, Track } from '@openaux/shared';
import type { VenueId } from '@openaux/shared';

/**
 * Thin injectable fetch so unit tests can mock network calls instead of
 * hitting real Spotify/Apple endpoints. Defaults to the global `fetch`.
 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * A cached bearer token plus its absolute expiry, used for both the Spotify
 * app-level client-credentials token and the Apple Music developer token.
 */
export interface CachedToken {
  token: string;
  /** Epoch ms after which the token must be refreshed. */
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// Spotify Connect playback requires a *user*-linked access token for the
// venue's own Spotify account (client-credentials tokens are app-only and
// cannot control playback). That token is obtained once via the standard
// OAuth authorization-code flow when a venue connects Spotify during setup
// (out of scope for this folder — owned by venue setup / WS4 & WS1), and
// must then be persisted and refreshed by the server per venue.
//
// VenueTokenStore is the seam for that persistence. WS2 only *defines* the
// interface and ships an in-memory stub so SpotifyProvider is usable and
// testable today; a real implementation (Postgres-backed, encrypted at
// rest) belongs to whichever workstream owns venue account linking.
// ---------------------------------------------------------------------------

export interface VenueMusicTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms after which accessToken must be refreshed. */
  expiresAt: number;
}

export interface VenueTokenStore {
  get(venueId: VenueId): Promise<VenueMusicTokens | null>;
  set(venueId: VenueId, tokens: VenueMusicTokens): Promise<void>;
}

/**
 * In-memory VenueTokenStore. Sufficient for unit tests and local dev wiring;
 * NOT durable across restarts. Real persistence (DB-backed, encrypted) is a
 * contract gap — see the TODO in this folder's README / final report.
 */
export class InMemoryVenueTokenStore implements VenueTokenStore {
  private readonly tokens = new Map<VenueId, VenueMusicTokens>();

  async get(venueId: VenueId): Promise<VenueMusicTokens | null> {
    return this.tokens.get(venueId) ?? null;
  }

  async set(venueId: VenueId, tokens: VenueMusicTokens): Promise<void> {
    this.tokens.set(venueId, tokens);
  }
}

// ---------------------------------------------------------------------------
// Apple Music has no server-side playback control API. MusicKit runs in the
// venue's own browser (the venue web console), so play/pause/skip/queueNext
// commands must be *relayed* to that browser session rather than executed
// via HTTP by this server. PlaybackBridge is that relay seam:
//
//   AppleMusicProvider.play(target) -> bridge.send(target, { type: 'play' })
//
// The bridge's real implementation belongs to whoever owns the realtime
// channel (apps/server/src/realtime/, WS1) plus the venue console UI (web
// workstream): it should forward the command down the venue's WebSocket
// connection and let MusicKit JS execute it client-side, then push
// now-playing state back up over the same channel so getNowPlaying can
// resolve it. WS2 only defines the interface and ships a no-op stub.
// ---------------------------------------------------------------------------

export type PlaybackCommand =
  { type: 'queueNext'; track: Track } | { type: 'play' } | { type: 'pause' } | { type: 'skip' };

export interface PlaybackBridge {
  /** Relay a playback command to the venue's MusicKit session. */
  send(target: PlaybackTarget, command: PlaybackCommand): Promise<void>;
  /** Read the last now-playing state reported by the venue's MusicKit session. */
  getNowPlaying(target: PlaybackTarget): Promise<NowPlayingState>;
}

/**
 * No-op PlaybackBridge stub. Commands are accepted but discarded, and
 * getNowPlaying always reports silence. Useful for tests and for booting the
 * server before the real bridge (WS1 realtime + web console) lands.
 */
export class NoopPlaybackBridge implements PlaybackBridge {
  async send(): Promise<void> {
    // Intentionally inert — see PlaybackBridge doc comment above.
  }

  async getNowPlaying(): Promise<NowPlayingState> {
    return { track: null, positionMs: 0, isPlaying: false };
  }
}
