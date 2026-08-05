/**
 * getProvider(venue) — keyed on venue.musicProvider, this is the only place
 * outside the individual adapters that needs to know both Spotify and Apple
 * Music exist. Everything else in the codebase should hold a MusicProvider
 * reference obtained from here.
 *
 * Providers are constructed from process.env by default (see
 * .env.example for the required vars) but every dependency is injectable
 * for tests. Provider instances are cached/reused across calls with the
 * same config so token caches (app token, developer token) stay warm.
 */
import type { MusicProvider, Venue } from '@openaux/shared';
import { pool } from '../db.js';
import { AppleMusicProvider } from './apple/apple-music-provider.js';
import { SpotifyProvider } from './spotify/spotify-provider.js';
import { TokenCipher, loadEncryptionKey } from './crypto.js';
import { PgVenueTokenStore } from './token-store.js';
import {
  InMemoryVenueTokenStore,
  NoopPlaybackBridge,
  type FetchLike,
  type PlaybackBridge,
  type VenueTokenStore,
} from './types.js';

export interface ProviderFactoryConfig {
  spotify?: {
    clientId: string;
    clientSecret: string;
  };
  appleMusic?: {
    teamId: string;
    keyId: string;
    privateKey: string;
    storefront: string;
  };
  /** Shared across both providers unless overridden. Defaults to an in-memory stub. */
  venueTokenStore?: VenueTokenStore;
  /** Shared across both providers unless overridden. Defaults to a no-op stub. */
  playbackBridge?: PlaybackBridge;
  fetchImpl?: FetchLike;
}

function readEnvConfig(): ProviderFactoryConfig {
  return {
    spotify: {
      clientId: process.env.SPOTIFY_CLIENT_ID ?? '',
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET ?? '',
    },
    appleMusic: {
      teamId: process.env.APPLE_MUSIC_TEAM_ID ?? '',
      keyId: process.env.APPLE_MUSIC_KEY_ID ?? '',
      // Env files commonly escape newlines in PEM blocks as literal `\n`.
      privateKey: (process.env.APPLE_MUSIC_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
      storefront: process.env.APPLE_MUSIC_STOREFRONT ?? 'us',
    },
  };
}

/**
 * Default venue token store. When TOKEN_ENCRYPTION_KEY is configured, this is
 * the durable, encrypted Postgres store (so a Spotify provider built from env
 * persists refreshed user tokens end to end). Falls back to the in-memory stub
 * for local dev / tests where no key is set.
 */
function defaultVenueTokenStore(): VenueTokenStore {
  const rawKey = process.env.TOKEN_ENCRYPTION_KEY;
  if (rawKey) {
    return new PgVenueTokenStore(pool, new TokenCipher(loadEncryptionKey(rawKey)));
  }
  return new InMemoryVenueTokenStore();
}

/**
 * Builds a MusicProvider for the given venue. Pass `config` to override env
 * defaults (required in tests, so no real network config/credentials are
 * needed to exercise the factory).
 */
export function getProvider(
  venue: Pick<Venue, 'musicProvider'>,
  config?: ProviderFactoryConfig,
): MusicProvider {
  const cfg = { ...readEnvConfig(), ...config };
  const venueTokenStore = cfg.venueTokenStore ?? defaultVenueTokenStore();
  const playbackBridge = cfg.playbackBridge ?? new NoopPlaybackBridge();

  switch (venue.musicProvider) {
    case 'spotify': {
      if (!cfg.spotify?.clientId || !cfg.spotify?.clientSecret) {
        throw new Error(
          'Spotify provider requested but SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET are not configured.',
        );
      }
      return new SpotifyProvider({
        clientId: cfg.spotify.clientId,
        clientSecret: cfg.spotify.clientSecret,
        tokenStore: venueTokenStore,
        fetchImpl: cfg.fetchImpl,
      });
    }
    case 'apple_music': {
      if (!cfg.appleMusic?.teamId || !cfg.appleMusic?.keyId || !cfg.appleMusic?.privateKey) {
        throw new Error(
          'Apple Music provider requested but APPLE_MUSIC_TEAM_ID / APPLE_MUSIC_KEY_ID / APPLE_MUSIC_PRIVATE_KEY are not configured.',
        );
      }
      return new AppleMusicProvider({
        teamId: cfg.appleMusic.teamId,
        keyId: cfg.appleMusic.keyId,
        privateKey: cfg.appleMusic.privateKey,
        storefront: cfg.appleMusic.storefront,
        playbackBridge,
        fetchImpl: cfg.fetchImpl,
      });
    }
    default: {
      const exhaustive: never = venue.musicProvider;
      throw new Error(`Unknown music provider: ${String(exhaustive)}`);
    }
  }
}
