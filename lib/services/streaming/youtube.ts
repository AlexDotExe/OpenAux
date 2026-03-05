/**
 * YouTube Streaming Service
 * Implements StreamingService using YouTube Data API v3.
 * Playback is client-side via iFrame — server-side play/pause/skip are no-ops.
 */

import { StreamingService, StreamingTrack, SearchResult, PlaybackState, OAuthTokens } from './types';
import { withValidToken } from './tokenManager';

const YOUTUBE_API = 'https://www.googleapis.com/youtube/v3';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

export function refreshYouTubeToken(refreshToken: string): Promise<OAuthTokens> {
  return refreshYouTubeTokenWithCredentials(
    refreshToken,
    process.env.YOUTUBE_CLIENT_ID!,
    process.env.YOUTUBE_CLIENT_SECRET!,
  );
}

export async function refreshYouTubeTokenWithCredentials(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<OAuthTokens> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`YouTube token refresh failed ${res.status}: ${text}`);
  }

  const data = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
    scope: data.scope,
  };
}

// Cached playback state reported by the client
let cachedPlaybackStates: Map<string, PlaybackState> = new Map();

export function updateYouTubePlaybackState(venueId: string, state: PlaybackState): void {
  cachedPlaybackStates.set(venueId, state);
}

export class YouTubeService implements StreamingService {
  readonly name = 'youtube' as const;
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
    this.tokens = await refreshYouTubeToken(this.tokens.refreshToken);
    return this.tokens;
  }

  async search(query: string, limit = 20): Promise<SearchResult> {
    return withValidToken(this.venueId, refreshYouTubeToken, async (token) => {
      // YouTube API requires maxResults between 1-50
      const validLimit = Math.max(1, Math.min(50, Math.floor(limit)));

      const params = new URLSearchParams({
        part: 'snippet',
        q: query,
        type: 'video',
        videoCategoryId: '10', // Music category
        maxResults: validLimit.toString(),
      });

      const res = await fetch(`${YOUTUBE_API}/search?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`YouTube API ${res.status}: ${text}`);
      }

      const data = await res.json();
      const tracks: StreamingTrack[] = (data.items ?? []).map(
        (item: { id: { videoId: string }; snippet: { title: string; channelTitle: string; thumbnails: { high?: { url: string } } } }) => ({
          serviceId: item.id.videoId,
          service: 'youtube' as const,
          title: item.snippet.title,
          artist: item.snippet.channelTitle,
          albumArtUrl: item.snippet.thumbnails?.high?.url,
        }),
      );

      return { tracks };
    });
  }

  // YouTube playback is client-side — these are no-ops on the server
  async play(): Promise<void> {}
  async pause(): Promise<void> {}
  async resume(): Promise<void> {}
  async skip(): Promise<void> {}

  async getPlaybackState(): Promise<PlaybackState | null> {
    return cachedPlaybackStates.get(this.venueId) ?? null;
  }
}
