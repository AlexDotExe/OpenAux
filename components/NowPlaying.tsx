'use client';

import { YouTubePlayer } from './YouTubePlayer';
import { SpotifyEmbeddedPlayer } from './SpotifyEmbeddedPlayer';

interface Props {
  venueId: string;
  adminToken: string;
  streamingService: string | null;
  onTrackEnded?: () => void;
  youtubeVideoId?: string | null;
  spotifyTrackId?: string | null;
}

export function NowPlaying({ streamingService, onTrackEnded, youtubeVideoId, spotifyTrackId }: Props) {
  // YouTube: render iFrame player
  if (streamingService === 'youtube' && youtubeVideoId) {
    return (
      <div className="bg-gray-900 rounded-xl p-4 space-y-3">
        <h2 className="font-semibold">Now Playing</h2>
        <YouTubePlayer videoId={youtubeVideoId} onEnded={onTrackEnded} />
      </div>
    );
  }

  // Spotify: render embedded iframe player
  if (streamingService === 'spotify') {
    return (
      <div className="space-y-3">
        <h2 className="font-semibold px-4 pt-4">Now Playing</h2>
        <SpotifyEmbeddedPlayer trackId={spotifyTrackId ?? null} onTrackEnded={onTrackEnded} />
      </div>
    );
  }

  // No playback state
  if (streamingService) {
    return (
      <div className="bg-gray-900 rounded-xl p-4">
        <h2 className="font-semibold mb-2">Now Playing</h2>
        <p className="text-gray-500 text-sm">Nothing playing. Advance the queue to start playback.</p>
      </div>
    );
  }

  return null;
}
