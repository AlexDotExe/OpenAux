/**
 * Spotify Streaming Service
 * Implements StreamingService using Spotify Web API + Spotify Connect.
 */

import { StreamingService, StreamingTrack, SearchResult, PlaybackState, OAuthTokens, PlaylistInfo, PlaylistTracksResult } from './types';
import { withValidToken } from './tokenManager';

const SPOTIFY_API = 'https://api.spotify.com/v1';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';

interface SpotifyDevice {
  id: string;
  name: string;
  type: string;
  is_active: boolean;
}

async function spotifyFetch(url: string, accessToken: string, options: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Spotify API ${res.status}: ${text}`);
  }
  return res;
}

export function refreshSpotifyToken(refreshToken: string): Promise<OAuthTokens> {
  return refreshSpotifyTokenWithCredentials(
    refreshToken,
    process.env.SPOTIFY_CLIENT_ID!,
    process.env.SPOTIFY_CLIENT_SECRET!,
  );
}

export async function refreshSpotifyTokenWithCredentials(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<OAuthTokens> {
  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Spotify token refresh failed ${res.status}: ${text}`);
  }

  const data = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
    scope: data.scope,
  };
}

export class SpotifyService implements StreamingService {
  readonly name = 'spotify' as const;
  private tokens: OAuthTokens;
  private venueId: string;

  constructor(tokens: OAuthTokens, venueId: string) {
    this.tokens = tokens;
    this.venueId = venueId;
  }

  isTokenValid(): boolean {
    return this.tokens.expiresAt.getTime() > Date.now();
  }

  async refreshAccessToken(): Promise<OAuthTokens> {
    this.tokens = await refreshSpotifyToken(this.tokens.refreshToken);
    return this.tokens;
  }

  async search(query: string, limit = 20): Promise<SearchResult> {
    return withValidToken(this.venueId, refreshSpotifyToken, async (token) => {
      // Don't use limit parameter - let Spotify use its default
      const url = `${SPOTIFY_API}/search?q=${encodeURIComponent(query)}&type=track`;

      const res = await spotifyFetch(url, token);
      const data = await res.json();

      const tracks: StreamingTrack[] = (data.tracks?.items ?? []).map((item: Record<string, unknown>) => ({
        serviceId: (item as { id: string }).id,
        service: 'spotify' as const,
        title: (item as { name: string }).name,
        artist: ((item as { artists: Array<{ name: string }> }).artists ?? []).map((a) => a.name).join(', '),
        albumArtUrl: ((item as { album: { images: Array<{ url: string }> } }).album?.images ?? [])[0]?.url,
        durationMs: (item as { duration_ms: number }).duration_ms,
      }));

      return { tracks };
    });
  }

  async play(trackId: string, deviceId?: string): Promise<void> {
    return withValidToken(this.venueId, refreshSpotifyToken, async (token) => {
      const params = deviceId ? `?device_id=${deviceId}` : '';
      await spotifyFetch(`${SPOTIFY_API}/me/player/play${params}`, token, {
        method: 'PUT',
        body: JSON.stringify({ uris: [`spotify:track:${trackId}`] }),
      });
    });
  }

  async addToQueue(trackId: string, deviceId?: string): Promise<void> {
    return withValidToken(this.venueId, refreshSpotifyToken, async (token) => {
      const uri = `spotify:track:${trackId}`;
      const params = new URLSearchParams({ uri });
      if (deviceId) params.append('device_id', deviceId);

      await spotifyFetch(`${SPOTIFY_API}/me/player/queue?${params}`, token, {
        method: 'POST',
      });
    });
  }

  async pause(): Promise<void> {
    return withValidToken(this.venueId, refreshSpotifyToken, async (token) => {
      await spotifyFetch(`${SPOTIFY_API}/me/player/pause`, token, { method: 'PUT' });
    });
  }

  async resume(): Promise<void> {
    return withValidToken(this.venueId, refreshSpotifyToken, async (token) => {
      await spotifyFetch(`${SPOTIFY_API}/me/player/play`, token, { method: 'PUT' });
    });
  }

  async skip(): Promise<void> {
    return withValidToken(this.venueId, refreshSpotifyToken, async (token) => {
      await spotifyFetch(`${SPOTIFY_API}/me/player/next`, token, { method: 'POST' });
    });
  }

  async getPlaybackState(): Promise<PlaybackState | null> {
    return withValidToken(this.venueId, refreshSpotifyToken, async (token) => {
      const res = await fetch(`${SPOTIFY_API}/me/player`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 204) return null;
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Spotify API ${res.status}: ${text}`);
      }
      const data = await res.json();
      if (!data || !data.item) return null;

      return {
        isPlaying: data.is_playing,
        currentTrack: {
          serviceId: data.item.id,
          service: 'spotify',
          title: data.item.name,
          artist: (data.item.artists ?? []).map((a: { name: string }) => a.name).join(', '),
          albumArtUrl: (data.item.album?.images ?? [])[0]?.url,
          durationMs: data.item.duration_ms,
        },
        progressMs: data.progress_ms ?? 0,
        durationMs: data.item.duration_ms ?? 0,
        deviceId: data.device?.id,
      };
    });
  }

  async getDevices(): Promise<SpotifyDevice[]> {
    return withValidToken(this.venueId, refreshSpotifyToken, async (token) => {
      const res = await spotifyFetch(`${SPOTIFY_API}/me/player/devices`, token);
      const data = await res.json();
      return data.devices ?? [];
    });
  }

  async transferPlayback(deviceId: string): Promise<void> {
    return withValidToken(this.venueId, refreshSpotifyToken, async (token) => {
      await spotifyFetch(`${SPOTIFY_API}/me/player`, token, {
        method: 'PUT',
        body: JSON.stringify({ device_ids: [deviceId] }),
      });
    });
  }

  async getUserPlaylists(limit = 50, offset = 0): Promise<{ playlists: PlaylistInfo[]; total: number }> {
    return withValidToken(this.venueId, refreshSpotifyToken, async (token) => {
      const url = `${SPOTIFY_API}/me/playlists?limit=${limit}&offset=${offset}`;
      const res = await spotifyFetch(url, token);
      const data = await res.json();

      return {
        playlists: (data.items ?? []).map((item: any) => ({
          id: item.id,
          name: item.name,
          description: item.description ?? null,
          imageUrl: item.images?.[0]?.url ?? null,
          trackCount: item.tracks.total,
        })),
        total: data.total,
      };
    });
  }

  async getPlaylistTracks(playlistId: string, limit = 50, offset = 0): Promise<PlaylistTracksResult> {
    return withValidToken(this.venueId, refreshSpotifyToken, async (token) => {
      const url = `${SPOTIFY_API}/playlists/${playlistId}/tracks?limit=${limit}&offset=${offset}`;
      const res = await spotifyFetch(url, token);
      const data = await res.json();

      const tracks: StreamingTrack[] = (data.items ?? [])
        .filter((item: any) => item.track && item.track.type === 'track')
        .map((item: any) => ({
          serviceId: item.track.id,
          service: 'spotify' as const,
          title: item.track.name,
          artist: (item.track.artists ?? []).map((a: any) => a.name).join(', '),
          albumArtUrl: item.track.album?.images?.[0]?.url,
          durationMs: item.track.duration_ms,
        }));

      return { tracks, total: data.total };
    });
  }
}
