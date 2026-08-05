/**
 * SpotifyProvider — MusicProvider adapter backed by the Spotify Web API
 * (catalog) and the Spotify Connect Web API (playback).
 *
 * Two distinct auth contexts:
 *  - Catalog (searchTracks/getTrack): app-level client-credentials token,
 *    cached + auto-refreshed by SpotifyAppTokenProvider. No user/venue
 *    context needed.
 *  - Playback (queueNext/play/pause/skip/getNowPlaying): a *user*-linked
 *    access token for the venue's own Spotify Premium account, obtained via
 *    OAuth authorization-code flow at venue setup time (out of scope here)
 *    and persisted/refreshed through the injected VenueTokenStore.
 */
import type {
  MusicProvider,
  NowPlayingState,
  PlaybackDevice,
  PlaybackTarget,
  Track,
} from '@openaux/shared';
import type { VenueId } from '@openaux/shared';
import type { FetchLike, VenueTokenStore } from '../types.js';
import { SpotifyAppTokenProvider } from './token.js';
import { mapSpotifyTrack, type SpotifyArtistJson, type SpotifyTrackJson } from './mapping.js';

const API_BASE = 'https://api.spotify.com/v1';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const REFRESH_SKEW_MS = 60_000;
const ARTIST_BATCH_SIZE = 50;

export interface SpotifyProviderConfig {
  clientId: string;
  clientSecret: string;
  tokenStore: VenueTokenStore;
  fetchImpl?: FetchLike;
}

export class SpotifyProvider implements MusicProvider {
  readonly id = 'spotify' as const;

  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly tokenStore: VenueTokenStore;
  private readonly fetchImpl: FetchLike;
  private readonly appToken: SpotifyAppTokenProvider;

  constructor(config: SpotifyProviderConfig) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.tokenStore = config.tokenStore;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.appToken = new SpotifyAppTokenProvider({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      fetchImpl: this.fetchImpl,
    });
  }

  // -- Catalog ---------------------------------------------------------

  async searchTracks(query: string, opts?: { limit?: number }): Promise<Track[]> {
    const limit = Math.min(opts?.limit ?? 20, 50);
    const params = new URLSearchParams({ q: query, type: 'track', limit: String(limit) });
    const res = await this.appRequest(`${API_BASE}/search?${params.toString()}`);
    const body = (await res.json()) as { tracks: { items: SpotifyTrackJson[] } };
    const items = body.tracks.items;
    const genresByArtistId = await this.fetchGenresForTracks(items);
    return items.map((item) => mapSpotifyTrack(item, genresByArtistId));
  }

  async getTrack(providerTrackId: string): Promise<Track | null> {
    const res = await this.appRequest(`${API_BASE}/tracks/${encodeURIComponent(providerTrackId)}`, {
      allow404: true,
    });
    if (res.status === 404) return null;
    const track = (await res.json()) as SpotifyTrackJson;
    const genresByArtistId = await this.fetchGenresForTracks([track]);
    return mapSpotifyTrack(track, genresByArtistId);
  }

  private async fetchGenresForTracks(tracks: SpotifyTrackJson[]): Promise<Map<string, string[]>> {
    const artistIds = Array.from(
      new Set(tracks.map((t) => t.artists[0]?.id).filter((id): id is string => Boolean(id))),
    );
    const genresByArtistId = new Map<string, string[]>();
    for (let i = 0; i < artistIds.length; i += ARTIST_BATCH_SIZE) {
      const chunk = artistIds.slice(i, i + ARTIST_BATCH_SIZE);
      const params = new URLSearchParams({ ids: chunk.join(',') });
      const res = await this.appRequest(`${API_BASE}/artists?${params.toString()}`);
      const body = (await res.json()) as { artists: SpotifyArtistJson[] };
      for (const artist of body.artists) {
        if (artist) genresByArtistId.set(artist.id, artist.genres ?? []);
      }
    }
    return genresByArtistId;
  }

  /** GET/generic request using the app-level client-credentials token, with one retry on 401. */
  private async appRequest(url: string, opts?: { allow404?: boolean }): Promise<Response> {
    const token = await this.appToken.getToken();
    let res = await this.fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) {
      const refreshed = await this.appToken.refresh();
      res = await this.fetchImpl(url, { headers: { Authorization: `Bearer ${refreshed}` } });
    }
    if (res.status === 404 && opts?.allow404) {
      return res;
    }
    if (!res.ok) {
      throw new Error(`Spotify API request failed: ${res.status} ${url}`);
    }
    return res;
  }

  // -- Playback (Spotify Connect, venue user token) ---------------------

  async queueNext(target: PlaybackTarget, track: Track): Promise<void> {
    const params = new URLSearchParams({
      uri: `spotify:track:${track.providerTrackId}`,
      device_id: target.providerDeviceId,
    });
    await this.userRequest(target.venueId, `${API_BASE}/me/player/queue?${params.toString()}`, {
      method: 'POST',
    });
  }

  async play(target: PlaybackTarget): Promise<void> {
    const params = new URLSearchParams({ device_id: target.providerDeviceId });
    await this.userRequest(target.venueId, `${API_BASE}/me/player/play?${params.toString()}`, {
      method: 'PUT',
    });
  }

  async pause(target: PlaybackTarget): Promise<void> {
    const params = new URLSearchParams({ device_id: target.providerDeviceId });
    await this.userRequest(target.venueId, `${API_BASE}/me/player/pause?${params.toString()}`, {
      method: 'PUT',
    });
  }

  async skip(target: PlaybackTarget): Promise<void> {
    const params = new URLSearchParams({ device_id: target.providerDeviceId });
    await this.userRequest(target.venueId, `${API_BASE}/me/player/next?${params.toString()}`, {
      method: 'POST',
    });
  }

  async getNowPlaying(target: PlaybackTarget): Promise<NowPlayingState> {
    const res = await this.userRequest(target.venueId, `${API_BASE}/me/player`, {
      method: 'GET',
      allowEmpty: true,
    });
    if (res.status === 204) {
      return { track: null, positionMs: 0, isPlaying: false };
    }
    const body = (await res.json()) as {
      item: SpotifyTrackJson | null;
      progress_ms: number | null;
      is_playing: boolean;
    };
    if (!body.item) {
      return { track: null, positionMs: 0, isPlaying: false };
    }
    const genresByArtistId = await this.fetchGenresForTracks([body.item]);
    return {
      track: mapSpotifyTrack(body.item, genresByArtistId),
      positionMs: body.progress_ms ?? 0,
      isPlaying: body.is_playing,
    };
  }

  /**
   * List the Spotify Connect devices visible to the venue's linked account.
   * Not part of the MusicProvider interface (playback-device selection is a
   * console/setup concern), but it reuses the same venue user-token
   * refresh-and-retry machinery as playback control.
   */
  async listDevices(venueId: VenueId): Promise<PlaybackDevice[]> {
    const res = await this.userRequest(venueId, `${API_BASE}/me/player/devices`, {
      method: 'GET',
    });
    const body = (await res.json()) as {
      devices: { id: string | null; name: string; is_active: boolean }[];
    };
    return body.devices
      .filter((d): d is { id: string; name: string; is_active: boolean } => Boolean(d.id))
      .map((d) => ({ providerDeviceId: d.id, name: d.name, isActive: d.is_active }));
  }

  /** Request using the venue's user-linked token, with refresh-and-retry on 401. */
  private async userRequest(
    venueId: VenueId,
    url: string,
    init: RequestInit & { allowEmpty?: boolean },
  ): Promise<Response> {
    const accessToken = await this.getVenueAccessToken(venueId);
    let res = await this.fetchImpl(url, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 401) {
      const refreshed = await this.refreshVenueAccessToken(venueId);
      res = await this.fetchImpl(url, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${refreshed}` },
      });
    }
    if (!res.ok && !(init.allowEmpty && res.status === 204)) {
      throw new Error(`Spotify Connect request failed: ${res.status} ${url}`);
    }
    return res;
  }

  private async getVenueAccessToken(venueId: VenueId): Promise<string> {
    const existing = await this.tokenStore.get(venueId);
    if (!existing) {
      throw new Error(
        `No Spotify account linked for venue ${venueId}. Complete OAuth authorization at venue setup first.`,
      );
    }
    if (existing.expiresAt - REFRESH_SKEW_MS > Date.now()) {
      return existing.accessToken;
    }
    return this.refreshVenueAccessToken(venueId);
  }

  private async refreshVenueAccessToken(venueId: VenueId): Promise<string> {
    const existing = await this.tokenStore.get(venueId);
    if (!existing) {
      throw new Error(
        `No Spotify account linked for venue ${venueId}. Complete OAuth authorization at venue setup first.`,
      );
    }
    const basicAuth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const res = await this.fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(existing.refreshToken)}`,
    });
    if (!res.ok) {
      throw new Error(`Spotify venue token refresh failed: ${res.status}`);
    }
    const body = (await res.json()) as {
      access_token: string;
      expires_in: number;
      refresh_token?: string;
    };
    const tokens = {
      accessToken: body.access_token,
      refreshToken: body.refresh_token ?? existing.refreshToken,
      expiresAt: Date.now() + body.expires_in * 1000,
    };
    await this.tokenStore.set(venueId, tokens);
    return tokens.accessToken;
  }
}
