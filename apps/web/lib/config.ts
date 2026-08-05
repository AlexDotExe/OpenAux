/**
 * Environment config for the web app. All flags are NEXT_PUBLIC_* so they're
 * available in the browser bundle — no secrets here.
 */

/** When '1', the app runs entirely against the in-memory mock fixture — no
 * backend required. Every screen must be demoable this way. */
export function isMockMode(): boolean {
  return process.env.NEXT_PUBLIC_API_MOCK === '1';
}

export function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';
}

export function wsBaseUrl(): string {
  return process.env.NEXT_PUBLIC_WS_BASE_URL ?? 'ws://localhost:4000';
}

/**
 * Which music provider the console should drive for playback (Apple = MusicKit
 * in this browser; Spotify = server-driven, read-only readout here).
 *
 * Contract gap (documented seam): VenueSummary (GET /api/venues/:venueId) does
 * NOT include the venue's musicProvider, so the console can't learn it from the
 * API today. Until the contract exposes it, we read NEXT_PUBLIC_VENUE_MUSIC_PROVIDER
 * (defaulting to 'spotify'). TODO(maintainer): add `musicProvider` to VenueSummary
 * and source it from there instead.
 */
export function resolveConsoleMusicProvider(): 'spotify' | 'apple_music' {
  return process.env.NEXT_PUBLIC_VENUE_MUSIC_PROVIDER === 'apple_music' ? 'apple_music' : 'spotify';
}
