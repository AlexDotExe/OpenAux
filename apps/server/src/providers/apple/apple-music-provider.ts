/**
 * AppleMusicProvider — MusicProvider adapter backed by the Apple Music
 * Catalog API (search/lookup) and a PlaybackBridge (playback control).
 *
 * Apple Music has no server-side playback control API: MusicKit JS runs in
 * the venue's own browser (the venue web console) and is the only thing
 * that can actually play/pause/skip audio there. So queueNext/play/pause/
 * skip/getNowPlaying on this provider do NOT call Apple's servers — they
 * relay a command through the injected PlaybackBridge (see ../types.ts),
 * which forwards it to the venue's MusicKit session (over the realtime
 * channel owned by WS1 + the venue console UI) and later reports state
 * back. Read the PlaybackBridge doc comment before wiring a real bridge.
 */
import type { MusicProvider, NowPlayingState, PlaybackTarget, Track } from '@openaux/shared';
import type { FetchLike, PlaybackBridge } from '../types.js';
import { AppleDeveloperTokenProvider } from './developer-token.js';
import { mapAppleSong, type AppleSongJson } from './mapping.js';

const API_BASE = 'https://api.music.apple.com/v1';

export interface AppleMusicProviderConfig {
  teamId: string;
  keyId: string;
  privateKey: string;
  /** ISO storefront code, e.g. 'us'. */
  storefront: string;
  playbackBridge: PlaybackBridge;
  fetchImpl?: FetchLike;
}

export class AppleMusicProvider implements MusicProvider {
  readonly id = 'apple_music' as const;

  private readonly storefront: string;
  private readonly playbackBridge: PlaybackBridge;
  private readonly fetchImpl: FetchLike;
  private readonly developerToken: AppleDeveloperTokenProvider;

  constructor(config: AppleMusicProviderConfig) {
    this.storefront = config.storefront;
    this.playbackBridge = config.playbackBridge;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.developerToken = new AppleDeveloperTokenProvider({
      teamId: config.teamId,
      keyId: config.keyId,
      privateKey: config.privateKey,
    });
  }

  // -- Catalog ---------------------------------------------------------

  async searchTracks(query: string, opts?: { limit?: number }): Promise<Track[]> {
    const limit = Math.min(opts?.limit ?? 20, 25);
    const params = new URLSearchParams({ term: query, types: 'songs', limit: String(limit) });
    const res = await this.request(
      `${API_BASE}/catalog/${this.storefront}/search?${params.toString()}`,
    );
    const body = (await res.json()) as {
      results?: { songs?: { data: AppleSongJson[] } };
    };
    const songs = body.results?.songs?.data ?? [];
    return songs.map(mapAppleSong);
  }

  async getTrack(providerTrackId: string): Promise<Track | null> {
    const res = await this.request(
      `${API_BASE}/catalog/${this.storefront}/songs/${encodeURIComponent(providerTrackId)}`,
      { allow404: true },
    );
    if (res.status === 404) return null;
    const body = (await res.json()) as { data: AppleSongJson[] };
    const song = body.data[0];
    if (!song) return null;
    return mapAppleSong(song);
  }

  /** GET request with the developer token, retrying once on 401. */
  private async request(url: string, opts?: { allow404?: boolean }): Promise<Response> {
    const token = this.developerToken.getToken();
    let res = await this.fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) {
      const refreshed = this.developerToken.refresh();
      res = await this.fetchImpl(url, { headers: { Authorization: `Bearer ${refreshed}` } });
    }
    if (res.status === 404 && opts?.allow404) {
      return res;
    }
    if (!res.ok) {
      throw new Error(`Apple Music API request failed: ${res.status} ${url}`);
    }
    return res;
  }

  // -- Playback (relayed via PlaybackBridge — see class doc comment) ----

  async queueNext(target: PlaybackTarget, track: Track): Promise<void> {
    await this.playbackBridge.send(target, { type: 'queueNext', track });
  }

  async play(target: PlaybackTarget): Promise<void> {
    await this.playbackBridge.send(target, { type: 'play' });
  }

  async pause(target: PlaybackTarget): Promise<void> {
    await this.playbackBridge.send(target, { type: 'pause' });
  }

  async skip(target: PlaybackTarget): Promise<void> {
    await this.playbackBridge.send(target, { type: 'skip' });
  }

  async getNowPlaying(target: PlaybackTarget): Promise<NowPlayingState> {
    return this.playbackBridge.getNowPlaying(target);
  }
}
