/**
 * playback/ — server side of the Apple/Spotify playback loop (NEW folder; see
 * CLAUDE.md ownership map). Public surface the maintainer wires in index.ts:
 *
 *  - RealtimePlaybackBridge: inject as ProviderFactoryConfig.playbackBridge so
 *    AppleMusicProvider relays commands to the console. Built with
 *    realtime/sendToConsole. Hook its .resolveCommand + share its .store with
 *    registerPlaybackRoutes.
 *  - registerPlaybackRoutes: app.register(...) with onTrackEnded -> queue advance,
 *    resolveCommand -> bridge.resolveCommand, stateStore -> bridge.store.
 *  - startSpotifyPlaybackPoller: start once with listActiveSpotifyVenues +
 *    onTrackEnded -> queue advance.
 */
export { PlaybackStateStore, type PlaybackSnapshot } from './state.js';
export { RealtimePlaybackBridge, type RealtimePlaybackBridgeDeps } from './bridge.js';
export { registerPlaybackRoutes, type PlaybackRoutesOptions } from './routes.js';
export {
  startSpotifyPlaybackPoller,
  type ActiveSpotifyVenue,
  type SpotifyPollerDeps,
  type SpotifyPollerHandle,
} from './spotify-poller.js';
export {
  EnvConsoleTokenProvider,
  createConsoleGuard,
  extractBearerToken,
  type ConsoleTokenProvider,
} from './auth.js';
