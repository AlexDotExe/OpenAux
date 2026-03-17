'use client';

import { useState, useEffect, useCallback } from 'react';
import { YouTubePlayer } from './YouTubePlayer';

interface PlaybackState {
  isPlaying: boolean;
  currentTrack: {
    serviceId: string;
    service: 'spotify' | 'youtube';
    title: string;
    artist: string;
    albumArtUrl?: string;
    durationMs?: number;
  } | null;
  progressMs: number;
  durationMs: number;
}

interface Props {
  venueId: string;
  streamingService: string | null;
  onTrackEnded?: () => void;
  youtubeVideoId?: string | null;
}

function formatTime(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function NowPlaying({ venueId, streamingService, onTrackEnded, youtubeVideoId }: Props) {
  const [playback, setPlayback] = useState<PlaybackState | null>(null);
  const [previousTrackId, setPreviousTrackId] = useState<string | null>(null);
  const [hasCalledTrackEnded, setHasCalledTrackEnded] = useState(false);
  const [isAdvancing, setIsAdvancing] = useState(false);

  const fetchPlayback = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/${venueId}/playback`);
      if (res.ok) {
        const data = await res.json();
        setPlayback(data.playback);
      }
    } catch {
      // Ignore fetch errors in polling
    }
  }, [venueId]);

  // Poll playback state for Spotify (every 2s for faster response)
  useEffect(() => {
    if (streamingService !== 'spotify') return;
    fetchPlayback();
    const interval = setInterval(fetchPlayback, 2000);
    return () => clearInterval(interval);
  }, [streamingService, fetchPlayback]);

  // Detect Spotify track changes (auto-advance) or track end
  useEffect(() => {
    if (!playback || streamingService !== 'spotify' || isAdvancing) return;

    const currentTrackId = playback.currentTrack?.serviceId;

    // Track changed - Spotify auto-advanced or manual skip
    if (currentTrackId && previousTrackId && currentTrackId !== previousTrackId) {
      console.log('[NowPlaying] Track changed from', previousTrackId, 'to', currentTrackId);
      setHasCalledTrackEnded(false); // Reset flag for new track
      setIsAdvancing(true);
      onTrackEnded?.();
      // Reset after 2 seconds to allow next track change
      setTimeout(() => setIsAdvancing(false), 2000);
    }

    // Track ended but didn't auto-advance (fallback)
    // Only call once per track to avoid multiple triggers
    if (
      currentTrackId &&
      !hasCalledTrackEnded &&
      !isAdvancing &&
      playback.durationMs > 0 &&
      playback.progressMs >= playback.durationMs - 2000 &&
      !playback.isPlaying
    ) {
      console.log('[NowPlaying] Track ended without auto-advance, calling onTrackEnded');
      setHasCalledTrackEnded(true); // Prevent multiple calls for same track
      setIsAdvancing(true);
      onTrackEnded?.();
      // Reset after 2 seconds
      setTimeout(() => setIsAdvancing(false), 2000);
    }

    if (currentTrackId && currentTrackId !== previousTrackId) {
      setPreviousTrackId(currentTrackId);
    }
  }, [playback, streamingService, onTrackEnded, previousTrackId, hasCalledTrackEnded, isAdvancing]);

  const handleAction = async (action: 'pause' | 'resume' | 'skip') => {
    await fetch(`/api/admin/${venueId}/playback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    if (action === 'skip') {
      onTrackEnded?.();
    } else {
      fetchPlayback();
    }
  };

  // YouTube: render iFrame player
  if (streamingService === 'youtube' && youtubeVideoId) {
    return (
      <div className="bg-gray-900 rounded-xl p-4 space-y-3">
        <h2 className="font-semibold">Now Playing</h2>
        <YouTubePlayer videoId={youtubeVideoId} onEnded={onTrackEnded} />
      </div>
    );
  }

  // Spotify: show playback state
  if (streamingService === 'spotify' && playback?.currentTrack) {
    const track = playback.currentTrack;
    const progressPct = playback.durationMs > 0 ? (playback.progressMs / playback.durationMs) * 100 : 0;

    return (
      <div className="bg-gray-900 rounded-xl p-4 space-y-3">
        <h2 className="font-semibold">Now Playing</h2>
        <div className="flex items-center gap-3">
          {track.albumArtUrl ? (
            <img src={track.albumArtUrl} alt="" className="w-14 h-14 rounded-lg object-cover" />
          ) : (
            <div className="w-14 h-14 rounded-lg bg-gray-700 flex items-center justify-center">
              <span className="text-gray-400">♪</span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm truncate">{track.title}</p>
            <p className="text-gray-400 text-xs truncate">{track.artist}</p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="space-y-1">
          <div className="w-full h-1.5 bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 rounded-full transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-gray-500">
            <span>{formatTime(playback.progressMs)}</span>
            <span>{formatTime(playback.durationMs)}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex justify-center gap-4">
          <button
            onClick={() => handleAction(playback.isPlaying ? 'pause' : 'resume')}
            className="bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {playback.isPlaying ? 'Pause' : 'Play'}
          </button>
          <button
            onClick={() => handleAction('skip')}
            className="bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            Skip
          </button>
        </div>
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
