import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { AppleMusicProvider } from './apple/apple-music-provider.js';
import { getProvider } from './factory.js';
import { SpotifyProvider } from './spotify/spotify-provider.js';

const { privateKey } = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

describe('getProvider', () => {
  it('returns a SpotifyProvider for venue.musicProvider === "spotify"', () => {
    const provider = getProvider(
      { musicProvider: 'spotify' },
      { spotify: { clientId: 'id', clientSecret: 'secret' }, fetchImpl: vi.fn() },
    );

    expect(provider).toBeInstanceOf(SpotifyProvider);
    expect(provider.id).toBe('spotify');
  });

  it('returns an AppleMusicProvider for venue.musicProvider === "apple_music"', () => {
    const provider = getProvider(
      { musicProvider: 'apple_music' },
      {
        appleMusic: { teamId: 'T', keyId: 'K', privateKey, storefront: 'us' },
        fetchImpl: vi.fn(),
      },
    );

    expect(provider).toBeInstanceOf(AppleMusicProvider);
    expect(provider.id).toBe('apple_music');
  });

  it('throws a clear error when Spotify credentials are missing', () => {
    expect(() =>
      getProvider({ musicProvider: 'spotify' }, { spotify: { clientId: '', clientSecret: '' } }),
    ).toThrow(/SPOTIFY_CLIENT_ID/);
  });

  it('throws a clear error when Apple Music credentials are missing', () => {
    expect(() =>
      getProvider(
        { musicProvider: 'apple_music' },
        { appleMusic: { teamId: '', keyId: '', privateKey: '', storefront: 'us' } },
      ),
    ).toThrow(/APPLE_MUSIC_TEAM_ID/);
  });
});
