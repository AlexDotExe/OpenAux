/**
 * MusicProvider — the single abstraction over Spotify and Apple Music.
 *
 * Rules:
 * - A venue picks exactly one provider; a live session uses one provider at a time.
 * - The venue device is the only playback owner. Patron phones never play audio.
 * - Server code outside apps/server/src/providers/ must depend only on this
 *   interface, never on a concrete SDK.
 */

import type { MusicProviderId } from '../types/domain.js';

export interface Track {
  provider: MusicProviderId;
  /** Provider-native track id (Spotify URI id / Apple Music catalog id). */
  providerTrackId: string;
  title: string;
  artist: string;
  album: string | null;
  durationMs: number;
  explicit: boolean;
  /** Provider genre(s) when available; used by eligibility blocks + ContextScore. */
  genres: string[];
  artworkUrl: string | null;
}

export interface NowPlayingState {
  track: Track | null;
  positionMs: number;
  isPlaying: boolean;
}

/** Opaque handle to the venue's playback device/session. */
export interface PlaybackTarget {
  venueId: string;
  providerDeviceId: string;
}

export interface MusicProvider {
  readonly id: MusicProviderId;

  searchTracks(query: string, opts?: { limit?: number }): Promise<Track[]>;
  getTrack(providerTrackId: string): Promise<Track | null>;

  /** Tell the venue device what plays next. Called only by the queue engine. */
  queueNext(target: PlaybackTarget, track: Track): Promise<void>;
  play(target: PlaybackTarget): Promise<void>;
  pause(target: PlaybackTarget): Promise<void>;
  skip(target: PlaybackTarget): Promise<void>;
  getNowPlaying(target: PlaybackTarget): Promise<NowPlayingState>;
}
