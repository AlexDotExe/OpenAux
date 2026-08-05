import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { NowPlayingState, PlaybackTarget, Track } from '@openaux/shared';
import type { PlaybackBridge } from '../types.js';
import { AppleMusicProvider } from './apple-music-provider.js';

const { privateKey } = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function queuedFetch(responses: Response[]): ReturnType<typeof vi.fn> {
  const queue = [...responses];
  return vi.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error('queuedFetch: no more responses queued');
    return next;
  });
}

class RecordingBridge implements PlaybackBridge {
  calls: Array<{ target: PlaybackTarget; command: Parameters<PlaybackBridge['send']>[1] }> = [];
  nowPlaying: NowPlayingState = { track: null, positionMs: 0, isPlaying: false };

  async send(
    target: PlaybackTarget,
    command: Parameters<PlaybackBridge['send']>[1],
  ): Promise<void> {
    this.calls.push({ target, command });
  }

  async getNowPlaying(): Promise<NowPlayingState> {
    return this.nowPlaying;
  }
}

function makeProvider(
  fetchImpl: ReturnType<typeof vi.fn>,
  bridge: PlaybackBridge = new RecordingBridge(),
) {
  return new AppleMusicProvider({
    teamId: 'TEAM',
    keyId: 'KEY',
    privateKey,
    storefront: 'us',
    playbackBridge: bridge,
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
}

const SAMPLE_SONG_JSON = {
  id: 'song-1',
  attributes: {
    name: 'Song One',
    artistName: 'Artist One',
    albumName: 'Album One',
    durationInMillis: 200_000,
    contentRating: 'explicit',
    genreNames: ['Pop', 'Dance'],
    artwork: { url: 'https://img/{w}x{h}bb.jpg', width: 3000, height: 3000 },
  },
};

describe('AppleMusicProvider.searchTracks', () => {
  it('maps catalog search results to the shared Track shape', async () => {
    const fetchImpl = queuedFetch([
      jsonResponse({ results: { songs: { data: [SAMPLE_SONG_JSON] } } }),
    ]);
    const provider = makeProvider(fetchImpl);

    const results = await provider.searchTracks('song one');

    expect(results).toEqual<Track[]>([
      {
        provider: 'apple_music',
        providerTrackId: 'song-1',
        title: 'Song One',
        artist: 'Artist One',
        album: 'Album One',
        durationMs: 200_000,
        explicit: true,
        genres: ['Pop', 'Dance'],
        artworkUrl: 'https://img/300x300bb.jpg',
      },
    ]);
  });

  it('returns an empty array when Apple returns no songs bucket', async () => {
    const fetchImpl = queuedFetch([jsonResponse({ results: {} })]);
    const provider = makeProvider(fetchImpl);

    const results = await provider.searchTracks('nonsense query');

    expect(results).toEqual([]);
  });

  it('retries once on 401 by minting a fresh developer token', async () => {
    const fetchImpl = queuedFetch([
      new Response(null, { status: 401 }),
      jsonResponse({ results: { songs: { data: [SAMPLE_SONG_JSON] } } }),
    ]);
    const provider = makeProvider(fetchImpl);

    const results = await provider.searchTracks('song one');

    expect(results).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const firstAuth = (fetchImpl.mock.calls[0]![1] as RequestInit).headers as Record<
      string,
      string
    >;
    const secondAuth = (fetchImpl.mock.calls[1]![1] as RequestInit).headers as Record<
      string,
      string
    >;
    expect(firstAuth.Authorization).not.toBe(secondAuth.Authorization);
  });
});

describe('AppleMusicProvider.getTrack', () => {
  it('returns null on 404', async () => {
    const fetchImpl = queuedFetch([new Response(null, { status: 404 })]);
    const provider = makeProvider(fetchImpl);

    const result = await provider.getTrack('missing-id');

    expect(result).toBeNull();
  });

  it('maps a found track', async () => {
    const fetchImpl = queuedFetch([jsonResponse({ data: [SAMPLE_SONG_JSON] })]);
    const provider = makeProvider(fetchImpl);

    const result = await provider.getTrack('song-1');

    expect(result?.providerTrackId).toBe('song-1');
    expect(result?.explicit).toBe(true);
    expect(result?.genres).toEqual(['Pop', 'Dance']);
  });

  it('throws on non-401/404 failures', async () => {
    const fetchImpl = queuedFetch([new Response('boom', { status: 500 })]);
    const provider = makeProvider(fetchImpl);

    await expect(provider.getTrack('song-1')).rejects.toThrow(
      /Apple Music API request failed: 500/,
    );
  });
});

describe('AppleMusicProvider playback — relayed via PlaybackBridge', () => {
  const target: PlaybackTarget = { venueId: 'venue-1', providerDeviceId: 'browser-session-1' };
  const track: Track = {
    provider: 'apple_music',
    providerTrackId: 'song-1',
    title: 'Song One',
    artist: 'Artist One',
    album: 'Album One',
    durationMs: 200_000,
    explicit: false,
    genres: [],
    artworkUrl: null,
  };

  it('never calls Apple servers for playback — commands go through the bridge', async () => {
    const fetchImpl = queuedFetch([]);
    const bridge = new RecordingBridge();
    const provider = makeProvider(fetchImpl, bridge);

    await provider.queueNext(target, track);
    await provider.play(target);
    await provider.pause(target);
    await provider.skip(target);
    await provider.getNowPlaying(target);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(bridge.calls.map((c) => c.command.type)).toEqual(['queueNext', 'play', 'pause', 'skip']);
    expect(bridge.calls[0]?.target).toEqual(target);
  });

  it('getNowPlaying returns whatever the bridge last reported', async () => {
    const fetchImpl = queuedFetch([]);
    const bridge = new RecordingBridge();
    bridge.nowPlaying = { track, positionMs: 42_000, isPlaying: true };
    const provider = makeProvider(fetchImpl, bridge);

    const state = await provider.getNowPlaying(target);

    expect(state).toEqual({ track, positionMs: 42_000, isPlaying: true });
  });
});
