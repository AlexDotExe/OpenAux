import { describe, expect, it, vi } from 'vitest';
import type { MusicProvider, NowPlayingState, PlaybackTarget, Track } from '@openaux/shared';
import { startSpotifyPlaybackPoller, type ActiveSpotifyVenue } from './spotify-poller.js';

const TARGET: PlaybackTarget = { venueId: 'venue-1', providerDeviceId: 'dev-1' };

function track(id: string): Track {
  return {
    provider: 'spotify',
    providerTrackId: id,
    title: id,
    artist: 'Artist',
    album: null,
    durationMs: 200_000,
    explicit: false,
    genres: [],
    artworkUrl: null,
  };
}

/** A provider whose getNowPlaying returns each queued state in order, repeating the last. */
function scriptedProvider(states: NowPlayingState[]): MusicProvider {
  let i = 0;
  return {
    id: 'spotify',
    searchTracks: async () => [],
    getTrack: async () => null,
    queueNext: async () => {},
    play: async () => {},
    pause: async () => {},
    skip: async () => {},
    getNowPlaying: async () => {
      const state = states[Math.min(i, states.length - 1)]!;
      i += 1;
      return state;
    },
  };
}

function playing(id: string): NowPlayingState {
  return { track: track(id), positionMs: 1000, isPlaying: true };
}
const IDLE: NowPlayingState = { track: null, positionMs: 0, isPlaying: false };

function venue(provider: MusicProvider): ActiveSpotifyVenue {
  return { venueId: 'venue-1', target: TARGET, provider };
}

describe('startSpotifyPlaybackPoller', () => {
  it('does not fire onTrackEnded on the first observation', async () => {
    const onTrackEnded = vi.fn(async () => {});
    const provider = scriptedProvider([playing('a')]);
    const poller = startSpotifyPlaybackPoller({
      listActiveSpotifyVenues: () => [venue(provider)],
      onTrackEnded,
    });
    await poller.poll();
    expect(onTrackEnded).not.toHaveBeenCalled();
    poller.stop();
  });

  it('fires onTrackEnded when the track changes to a different track', async () => {
    const onTrackEnded = vi.fn(async () => {});
    const provider = scriptedProvider([playing('a'), playing('b')]);
    const poller = startSpotifyPlaybackPoller({
      listActiveSpotifyVenues: () => [venue(provider)],
      onTrackEnded,
    });
    await poller.poll();
    await poller.poll();
    expect(onTrackEnded).toHaveBeenCalledTimes(1);
    expect(onTrackEnded).toHaveBeenCalledWith('venue-1');
    poller.stop();
  });

  it('fires onTrackEnded when playback transitions to idle', async () => {
    const onTrackEnded = vi.fn(async () => {});
    const provider = scriptedProvider([playing('a'), IDLE]);
    const poller = startSpotifyPlaybackPoller({
      listActiveSpotifyVenues: () => [venue(provider)],
      onTrackEnded,
    });
    await poller.poll();
    await poller.poll();
    expect(onTrackEnded).toHaveBeenCalledTimes(1);
    poller.stop();
  });

  it('does not re-fire while the same track keeps playing', async () => {
    const onTrackEnded = vi.fn(async () => {});
    const provider = scriptedProvider([playing('a'), playing('a'), playing('a')]);
    const poller = startSpotifyPlaybackPoller({
      listActiveSpotifyVenues: () => [venue(provider)],
      onTrackEnded,
    });
    await poller.poll();
    await poller.poll();
    await poller.poll();
    expect(onTrackEnded).not.toHaveBeenCalled();
    poller.stop();
  });

  it('isolates a failing venue via onError without stopping the sweep', async () => {
    const onTrackEnded = vi.fn(async () => {});
    const onError = vi.fn();
    const bad: MusicProvider = {
      ...scriptedProvider([playing('a')]),
      getNowPlaying: async () => {
        throw new Error('spotify 500');
      },
    };
    const good = scriptedProvider([playing('a'), playing('b')]);
    const poller = startSpotifyPlaybackPoller({
      listActiveSpotifyVenues: () => [
        { venueId: 'venue-bad', target: TARGET, provider: bad },
        { venueId: 'venue-good', target: TARGET, provider: good },
      ],
      onTrackEnded,
      onError,
    });
    await poller.poll();
    await poller.poll();
    expect(onError).toHaveBeenCalled();
    expect(onTrackEnded).toHaveBeenCalledWith('venue-good');
    poller.stop();
  });

  it("runs on an unref'd interval and stops cleanly", async () => {
    vi.useFakeTimers();
    try {
      const onTrackEnded = vi.fn(async () => {});
      const provider = scriptedProvider([playing('a'), playing('b'), playing('c')]);
      const poller = startSpotifyPlaybackPoller({
        listActiveSpotifyVenues: () => [venue(provider)],
        onTrackEnded,
        intervalMs: 5000,
      });
      await vi.advanceTimersByTimeAsync(5000); // first sweep: records 'a'
      await vi.advanceTimersByTimeAsync(5000); // second sweep: 'a' -> 'b' => fire
      expect(onTrackEnded).toHaveBeenCalledTimes(1);
      poller.stop();
      await vi.advanceTimersByTimeAsync(20000);
      expect(onTrackEnded).toHaveBeenCalledTimes(1); // no more sweeps after stop
    } finally {
      vi.useRealTimers();
    }
  });

  it('forgets a venue that drops out of the active list', async () => {
    const onTrackEnded = vi.fn(async () => {});
    let active = true;
    const provider = scriptedProvider([playing('a'), playing('b')]);
    const poller = startSpotifyPlaybackPoller({
      listActiveSpotifyVenues: () => (active ? [venue(provider)] : []),
      onTrackEnded,
    });
    await poller.poll(); // sees 'a'
    active = false;
    await poller.poll(); // venue inactive -> forgotten
    active = true;
    await poller.poll(); // sees 'b' fresh, treated as first observation -> no fire
    expect(onTrackEnded).not.toHaveBeenCalled();
    poller.stop();
  });
});
