import { describe, expect, it } from 'vitest';
import type { PlaybackTarget } from '@openaux/shared';
import { FakeMusicProvider } from './fake-music-provider.js';

describe('FakeMusicProvider.searchTracks', () => {
  it('returns deterministic matches from the fixed in-repo catalog', async () => {
    const provider = new FakeMusicProvider('spotify');

    const results = await provider.searchTracks('neon');

    expect(results.map((track) => track.providerTrackId)).toEqual([
      'fake-track-001',
      'fake-track-013',
    ]);
    expect(results[0]?.explicit).toBe(false);
    expect(results[1]?.genres).toContain('country');
  });

  it('maps the fixed catalog to the requested provider id and respects limit', async () => {
    const provider = new FakeMusicProvider('apple_music');

    const results = await provider.searchTracks('pop', { limit: 2 });

    expect(results).toHaveLength(2);
    expect(results.every((track) => track.provider === 'apple_music')).toBe(true);
  });
});

describe('FakeMusicProvider playback state', () => {
  const target: PlaybackTarget = { venueId: 'venue-1', providerDeviceId: 'fake-device' };

  it('queues tracks, starts playback, pauses, skips, and returns silence at the end', async () => {
    const provider = new FakeMusicProvider('spotify');
    const firstTrack = await provider.getTrack('fake-track-001');
    const secondTrack = await provider.getTrack('fake-track-002');

    expect(firstTrack).not.toBeNull();
    expect(secondTrack).not.toBeNull();

    await provider.queueNext(target, firstTrack!);
    await provider.queueNext(target, secondTrack!);

    expect(await provider.getNowPlaying(target)).toEqual({
      track: null,
      positionMs: 0,
      isPlaying: false,
    });

    await provider.play(target);
    expect(await provider.getNowPlaying(target)).toEqual({
      track: firstTrack,
      positionMs: 0,
      isPlaying: true,
    });

    await provider.pause(target);
    expect(await provider.getNowPlaying(target)).toEqual({
      track: firstTrack,
      positionMs: 0,
      isPlaying: false,
    });

    await provider.skip(target);
    expect(await provider.getNowPlaying(target)).toEqual({
      track: secondTrack,
      positionMs: 0,
      isPlaying: true,
    });

    await provider.skip(target);
    expect(await provider.getNowPlaying(target)).toEqual({
      track: null,
      positionMs: 0,
      isPlaying: false,
    });
  });
});
