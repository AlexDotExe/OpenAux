/**
 * Streaming Service Abstraction Layer
 * Shared interfaces for Spotify and YouTube integration.
 */

export interface StreamingTrack {
  serviceId: string; // Spotify track ID or YouTube video ID
  service: 'spotify' | 'youtube';
  title: string;
  artist: string;
  albumArtUrl?: string;
  durationMs?: number;
  bpm?: number;
}

export interface SearchResult {
  tracks: StreamingTrack[];
}

export interface PlaybackState {
  isPlaying: boolean;
  currentTrack: StreamingTrack | null;
  progressMs: number;
  durationMs: number;
  deviceId?: string;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scope?: string;
}

export interface StreamingService {
  readonly name: 'spotify' | 'youtube';

  search(query: string, limit?: number): Promise<SearchResult>;
  play(trackId: string, deviceId?: string): Promise<void>;
  addToQueue?(trackId: string, deviceId?: string): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  skip(): Promise<void>;
  getPlaybackState(): Promise<PlaybackState | null>;
  isTokenValid(): boolean;
  refreshAccessToken(): Promise<OAuthTokens>;
}
