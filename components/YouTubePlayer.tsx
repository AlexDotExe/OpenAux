'use client';

import { useEffect, useRef, useCallback, useState } from 'react';

declare global {
  interface Window {
    YT: typeof YT;
    onYouTubeIframeAPIReady: (() => void) | undefined;
  }
}

declare namespace YT {
  class Player {
    constructor(elementId: string, options: PlayerOptions);
    loadVideoById(videoId: string): void;
    loadPlaylist(playlist: string | string[] | { list: string; listType: string; index?: number; startSeconds?: number }): void;
    playVideo(): void;
    pauseVideo(): void;
    seekTo(seconds: number, allowSeekAhead: boolean): void;
    nextVideo(): void;
    previousVideo(): void;
    getPlaylistIndex(): number;
    getCurrentTime(): number;
    getDuration(): number;
    getPlayerState(): number;
    destroy(): void;
  }
  interface PlayerOptions {
    height?: string | number;
    width?: string | number;
    videoId?: string;
    playerVars?: Record<string, number | string>;
    events?: {
      onReady?: (event: PlayerEvent) => void;
      onStateChange?: (event: OnStateChangeEvent) => void;
      onError?: (event: PlayerEvent) => void;
    };
  }
  interface PlayerEvent {
    target: Player;
    data?: number;
  }
  interface OnStateChangeEvent {
    target: Player;
    data: number;
  }
  enum PlayerState {
    UNSTARTED = -1,
    ENDED = 0,
    PLAYING = 1,
    PAUSED = 2,
    BUFFERING = 3,
    CUED = 5,
  }
}

interface YouTubePlayerProps {
  videoId: string | null;
  playlistId?: string | null;
  onEnded: () => void;
  onSkipForward?: () => void;
  onSkipBack?: () => void;
  onStateChange?: (state: {
    isPlaying: boolean;
    progressMs: number;
    durationMs: number;
    videoId: string;
  }) => void;
}

// Module-level promise to prevent double-loading the IFrame API script
let apiLoadPromise: Promise<void> | null = null;

function loadYouTubeApi(): Promise<void> {
  if (apiLoadPromise) return apiLoadPromise;

  apiLoadPromise = new Promise<void>((resolve) => {
    if (window.YT && window.YT.Player) {
      resolve();
      return;
    }
    window.onYouTubeIframeAPIReady = () => resolve();
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(script);
  });

  return apiLoadPromise;
}

export function YouTubePlayer({ videoId, playlistId, onEnded, onSkipForward, onSkipBack, onStateChange }: YouTubePlayerProps) {
  const playerRef = useRef<YT.Player | null>(null);
  const expectedVideoIdRef = useRef<string | null>(null);
  const playlistModeRef = useRef(false);
  const savedPlaylistIndexRef = useRef<number>(0);
  const pendingVideoIdRef = useRef<string | null>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const containerIdRef = useRef('yt-player-' + Math.random().toString(36).slice(2, 9));
  const onEndedRef = useRef(onEnded);
  const onStateChangeRef = useRef(onStateChange);
  const [isPlaying, setIsPlaying] = useState(false);

  // Keep callback refs up to date
  onEndedRef.current = onEnded;
  onStateChangeRef.current = onStateChange;

  const clearProgressInterval = useCallback(() => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
  }, []);

  const startProgressInterval = useCallback(() => {
    clearProgressInterval();
    progressIntervalRef.current = setInterval(() => {
      const player = playerRef.current;
      const vid = expectedVideoIdRef.current;
      if (!player || !vid) return;
      try {
        const currentTime = player.getCurrentTime();
        const duration = player.getDuration();
        onStateChangeRef.current?.({
          isPlaying: true,
          progressMs: Math.round(currentTime * 1000),
          durationMs: Math.round(duration * 1000),
          videoId: vid,
        });
      } catch {
        // Player may not be ready
      }
    }, 1000);
  }, [clearProgressInterval]);

  // Initialize player once
  useEffect(() => {
    let destroyed = false;
    const containerId = containerIdRef.current;

    loadYouTubeApi().then(() => {
      if (destroyed) return;

      playerRef.current = new window.YT.Player(containerId, {
        height: '100%',
        width: '100%',
        playerVars: {
          autoplay: 1,
          controls: 1,
          rel: 0,
          modestbranding: 1,
        },
        events: {
          onReady: () => {
            // If a videoId was set before the player was ready, load it
            if (expectedVideoIdRef.current) {
              playerRef.current?.loadVideoById(expectedVideoIdRef.current);
            } else if (playlistModeRef.current) {
              // No queue video — start the playlist
              // playlistId is read from the ref set by the effect below
            }
          },
          onStateChange: (event: YT.OnStateChangeEvent) => {
            const state = event.data;

            // Check for pending queue video on any non-playing transition
            // YouTube playlists can auto-advance through ENDED -> UNSTARTED -> CUED
            // without reliably stopping, so catch all "stopped" states
            if (pendingVideoIdRef.current && (state === 0 || state === -1 || state === 5)) {
              clearProgressInterval();
              const vid = pendingVideoIdRef.current;
              pendingVideoIdRef.current = null;
              expectedVideoIdRef.current = vid;
              try {
                const idx = event.target.getPlaylistIndex();
                if (idx !== undefined && idx >= 0) {
                  savedPlaylistIndexRef.current = idx + 1;
                }
              } catch { /* ignore */ }
              playlistModeRef.current = false;
              try { event.target.loadVideoById(vid); } catch { /* ignore */ }
              return;
            }

            if (state === 0 /* ENDED */) {
              clearProgressInterval();
              // Only fire onEnded for queue songs (not playlist — YouTube auto-advances those)
              if (expectedVideoIdRef.current && !playlistModeRef.current) {
                onEndedRef.current();
              }
            } else if (state === 1 /* PLAYING */) {
              setIsPlaying(true);
              startProgressInterval();
            } else if (state === 2 /* PAUSED */) {
              setIsPlaying(false);
              clearProgressInterval();
              const player = playerRef.current;
              const vid = expectedVideoIdRef.current;
              if (player && vid) {
                try {
                  onStateChangeRef.current?.({
                    isPlaying: false,
                    progressMs: Math.round(player.getCurrentTime() * 1000),
                    durationMs: Math.round(player.getDuration() * 1000),
                    videoId: vid,
                  });
                } catch {
                  // ignore
                }
              }
            }
          },
          onError: () => {
            // On error for queue songs, treat as ended so orchestrator can advance
            if (expectedVideoIdRef.current && !playlistModeRef.current) {
              onEndedRef.current();
            }
          },
        },
      });
    });

    return () => {
      destroyed = true;
      clearProgressInterval();
      try {
        playerRef.current?.destroy();
      } catch {
        // ignore
      }
      playerRef.current = null;
    };
  }, [clearProgressInterval, startProgressInterval]);

  // Helper: load a queue video immediately, saving playlist position first
  const loadQueueVideo = useCallback((vid: string) => {
    pendingVideoIdRef.current = null;
    expectedVideoIdRef.current = vid;
    const player = playerRef.current;
    // Save playlist position before switching to queue
    if (playlistModeRef.current && player) {
      try {
        const idx = player.getPlaylistIndex();
        if (idx !== undefined && idx >= 0) {
          savedPlaylistIndexRef.current = idx + 1;
        }
      } catch {
        // ignore
      }
    }
    playlistModeRef.current = false;
    if (player) {
      try {
        player.loadVideoById(vid);
      } catch {
        // Player may not be initialized yet; onReady will handle it
      }
    }
  }, []);

  // Handle videoId changes (queue songs override playlist)
  useEffect(() => {
    if (videoId) {
      // Only defer if a playlist track is actively playing or buffering
      if (playlistModeRef.current && playerRef.current) {
        try {
          const state = playerRef.current.getPlayerState();
          if (state === 1 /* PLAYING */ || state === 3 /* BUFFERING */) {
            pendingVideoIdRef.current = videoId;
            return;
          }
        } catch {
          // Player not ready — don't defer, load directly
        }
      }
      loadQueueVideo(videoId);
    } else {
      pendingVideoIdRef.current = null;
      expectedVideoIdRef.current = null;
    }
  }, [videoId, loadQueueVideo]);

  // Handle playlistId changes (fallback when no videoId)
  useEffect(() => {
    if (videoId) return; // Queue song is playing, don't load playlist
    if (!playlistId) {
      playlistModeRef.current = false;
      clearProgressInterval();
      return;
    }
    playlistModeRef.current = true;
    expectedVideoIdRef.current = null;
    const player = playerRef.current;
    if (player) {
      try {
        player.loadPlaylist({ list: playlistId, listType: 'playlist', index: savedPlaylistIndexRef.current });
      } catch {
        // Player may not be ready
      }
    }
  }, [playlistId, videoId, clearProgressInterval]);

  const handleBack = useCallback(() => {
    if (onSkipBack) {
      onSkipBack();
      return;
    }
    const player = playerRef.current;
    if (!player) return;
    try {
      if (playlistModeRef.current) {
        player.previousVideo();
      } else {
        player.seekTo(0, true);
      }
    } catch {
      // Player may not be ready
    }
  }, [onSkipBack]);

  const handlePlayPause = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    try {
      if (isPlaying) {
        player.pauseVideo();
      } else {
        player.playVideo();
      }
    } catch {
      // Player may not be ready
    }
  }, [isPlaying]);

  return (
    <div>
      {/* Controls */}
      <div className="flex items-center justify-center gap-6 py-2">
        <button
          onClick={handleBack}
          className="text-gray-400 hover:text-white transition-colors p-2"
          aria-label="Previous"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
          </svg>
        </button>
        <button
          onClick={handlePlayPause}
          className="text-white hover:text-gray-200 transition-colors p-2"
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? (
            <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
            </svg>
          ) : (
            <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>
        <button
          onClick={() => {
            if (playlistModeRef.current) {
              try { playerRef.current?.nextVideo(); } catch { /* ignore */ }
            } else {
              onSkipForward?.();
            }
          }}
          className="text-gray-400 hover:text-white transition-colors p-2"
          aria-label="Next"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
          </svg>
        </button>
      </div>
      {/* Player */}
      <div className="w-full aspect-video bg-black rounded-lg overflow-hidden">
        <div id={containerIdRef.current} />
      </div>
    </div>
  );
}
