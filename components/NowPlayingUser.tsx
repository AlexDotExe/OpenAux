'use client';

import { useEffect, useState } from 'react';

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

interface SponsorInfo {
  promotionText: string | null;
  isAnthem: boolean;
}

interface NowPlayingUserProps {
  sessionId: string;
  onPlaybackUpdate?: (remainingMs: number) => void;
}

export function NowPlayingUser({ sessionId, onPlaybackUpdate }: NowPlayingUserProps) {
  const [playback, setPlayback] = useState<PlaybackState | null>(null);
  const [requesterName, setRequesterName] = useState<string | null>(null);
  const [sponsorInfo, setSponsorInfo] = useState<SponsorInfo | null>(null);

  useEffect(() => {
    const fetchPlayback = async () => {
      try {
        const res = await fetch(`/api/sessions/${sessionId}/playback`);
        if (!res.ok) return;
        const data = await res.json();
        setPlayback(data.playback);
        setRequesterName(data.requesterName ?? null);
        setSponsorInfo(data.sponsorInfo ?? null);
        if (onPlaybackUpdate && data.playback) {
          const remainingMs = Math.max(0, (data.playback.durationMs ?? 0) - (data.playback.progressMs ?? 0));
          onPlaybackUpdate(remainingMs);
        }
      } catch (error) {
        console.error('Failed to fetch playback state:', error);
      }
    };

    fetchPlayback();
    const interval = setInterval(fetchPlayback, 5000); // Poll every 5 seconds

    return () => clearInterval(interval);
  }, [sessionId, onPlaybackUpdate]);

  if (!playback || !playback.currentTrack) {
    return null; // Graceful empty state
  }

  const { currentTrack, progressMs, durationMs, isPlaying } = playback;
  const progressPercent = durationMs > 0 ? (progressMs / durationMs) * 100 : 0;

  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="space-y-3">
      {/* Anthem / Sponsor Song Announcement */}
      {sponsorInfo && (
        <div className="bg-amber-900/40 border border-amber-500 rounded-xl p-4 animate-pulse">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xl">{sponsorInfo.isAnthem ? '🎺' : '⭐'}</span>
            <p className="text-amber-300 font-bold text-sm">
              {sponsorInfo.isAnthem ? 'Venue Anthem Playing!' : 'Sponsor Song Playing!'}
            </p>
          </div>
          {sponsorInfo.promotionText && (
            <p className="text-amber-200 text-xs mt-1 pl-8">
              🎁 {sponsorInfo.promotionText}
            </p>
          )}
        </div>
      )}

      <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
        {requesterName && (
          <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-green-950/50 border border-green-700/50 rounded-lg">
            <span className="text-lg">🎧</span>
            <p className="text-sm font-semibold text-green-400">
              DJ {requesterName} is playing...
            </p>
            <span className="ml-auto flex gap-0.5" aria-hidden="true">
              <span className="w-1 h-3 bg-green-400 rounded-full animate-bounce [animation-delay:0ms]" />
              <span className="w-1 h-3 bg-green-400 rounded-full animate-bounce [animation-delay:150ms]" />
              <span className="w-1 h-3 bg-green-400 rounded-full animate-bounce [animation-delay:300ms]" />
            </span>
          </div>
        )}

        <h3 className="text-sm font-semibold text-gray-400 mb-3">Now Playing</h3>

        <div className="flex gap-4">
          {currentTrack.albumArtUrl && (
            <img
              src={currentTrack.albumArtUrl}
              alt={`${currentTrack.title} album art`}
              className="w-20 h-20 rounded object-cover flex-shrink-0"
            />
          )}

          <div className="flex-1 min-w-0">
            <h4 className="text-white font-semibold truncate">{currentTrack.title}</h4>
            <p className="text-gray-400 text-sm truncate">{currentTrack.artist}</p>

            <div className="mt-3">
              <div className="w-full bg-gray-700 rounded-full h-1.5 mb-1">
                <div
                  className="bg-green-500 h-1.5 rounded-full transition-all"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

              <div className="flex justify-between text-xs text-gray-500">
                <span>{formatTime(progressMs)}</span>
                <span>{formatTime(durationMs)}</span>
              </div>
            </div>

            {!isPlaying && (
              <p className="text-xs text-gray-500 mt-2">Paused</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
