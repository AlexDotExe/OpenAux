import { describe, expect, it, vi } from 'vitest';
import type { PlaybackCommandEvent, Track } from '@openaux/shared';

import { buildStateReport, executePlaybackCommand, type MusicKitInstance } from './musicKit';

const TRACK: Track = {
  provider: 'apple_music',
  providerTrackId: 'am-123',
  title: 'Song',
  artist: 'Artist',
  album: null,
  durationMs: 200_000,
  explicit: false,
  genres: [],
  artworkUrl: null,
};

function fakeMusicKit(overrides: Partial<MusicKitInstance> = {}): MusicKitInstance {
  return {
    setQueue: vi.fn(async () => {}),
    play: vi.fn(async () => {}),
    pause: vi.fn(async () => {}),
    skipToNextItem: vi.fn(async () => {}),
    isPlaying: false,
    currentPlaybackTime: 0,
    nowPlayingItem: null,
    ...overrides,
  };
}

function payload(
  command: PlaybackCommandEvent['payload']['command'],
  track: Track | null = null,
  commandId = 'cmd-1',
): PlaybackCommandEvent['payload'] {
  return { command, track, commandId };
}

describe('executePlaybackCommand', () => {
  it('queue_next sets the queue to the track and plays', async () => {
    const mk = fakeMusicKit();
    await executePlaybackCommand(mk, payload('queue_next', TRACK));
    expect(mk.setQueue).toHaveBeenCalledWith({ song: 'am-123' });
    expect(mk.play).toHaveBeenCalledTimes(1);
  });

  it('queue_next with a null track is a no-op', async () => {
    const mk = fakeMusicKit();
    await executePlaybackCommand(mk, payload('queue_next', null));
    expect(mk.setQueue).not.toHaveBeenCalled();
    expect(mk.play).not.toHaveBeenCalled();
  });

  it('play calls play()', async () => {
    const mk = fakeMusicKit();
    await executePlaybackCommand(mk, payload('play'));
    expect(mk.play).toHaveBeenCalledTimes(1);
  });

  it('pause calls pause()', async () => {
    const mk = fakeMusicKit();
    await executePlaybackCommand(mk, payload('pause'));
    expect(mk.pause).toHaveBeenCalledTimes(1);
  });

  it('skip calls skipToNextItem()', async () => {
    const mk = fakeMusicKit();
    await executePlaybackCommand(mk, payload('skip'));
    expect(mk.skipToNextItem).toHaveBeenCalledTimes(1);
  });
});

describe('buildStateReport', () => {
  it('snapshots isPlaying, position (ms), and the current provider track id', () => {
    const mk = fakeMusicKit({
      isPlaying: true,
      currentPlaybackTime: 12.4,
      nowPlayingItem: { id: 'am-999' },
    });
    expect(buildStateReport(mk)).toEqual({
      isPlaying: true,
      positionMs: 12400,
      providerTrackId: 'am-999',
    });
  });

  it('reports a null track id when nothing is loaded', () => {
    expect(buildStateReport(fakeMusicKit()).providerTrackId).toBeNull();
  });

  it('includes commandId and trackEnded only when requested', () => {
    const mk = fakeMusicKit({ nowPlayingItem: { id: 'am-1' } });
    expect(buildStateReport(mk, { commandId: 'cmd-7' })).toMatchObject({ commandId: 'cmd-7' });
    expect(buildStateReport(mk, { trackEnded: true })).toMatchObject({ trackEnded: true });
    expect('trackEnded' in buildStateReport(mk)).toBe(false);
    expect('commandId' in buildStateReport(mk)).toBe(false);
  });

  it('never emits a negative position', () => {
    const mk = fakeMusicKit({ currentPlaybackTime: -1 });
    expect(buildStateReport(mk).positionMs).toBe(0);
  });
});
