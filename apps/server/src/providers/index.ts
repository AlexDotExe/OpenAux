/**
 * providers/ — WS2 ownership. Only this folder may import Spotify/Apple
 * Music APIs (CLAUDE.md rule 4). Everything else depends on the
 * MusicProvider interface re-exported from @openaux/shared.
 */
export { SpotifyProvider, type SpotifyProviderConfig } from './spotify/spotify-provider.js';
export { AppleMusicProvider, type AppleMusicProviderConfig } from './apple/apple-music-provider.js';
export { FakeMusicProvider } from './fake/index.js';
export { getProvider, type ProviderFactoryConfig } from './factory.js';
export {
  InMemoryVenueTokenStore,
  NoopPlaybackBridge,
  type CachedToken,
  type FetchLike,
  type PlaybackBridge,
  type PlaybackCommand,
  type VenueMusicTokens,
  type VenueTokenStore,
} from './types.js';

// Spotify account linking + playback-device selection (WS2 playback wiring).
export {
  registerProviderAuthRoutes,
  type ProviderAuthRoutesOptions,
  type DeviceLister,
} from './auth-routes.js';
export {
  PgVenueTokenStore,
  setVenuePlaybackDeviceId,
  type QueryablePool,
  type VenueLinkInput,
  type VenueLinkStatus,
} from './token-store.js';
export { TokenCipher, loadEncryptionKey } from './crypto.js';
