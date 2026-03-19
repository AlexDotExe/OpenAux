'use client';

import { useEffect, useRef, useCallback } from 'react';

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
    loadPlaylist(playlist: string | string[] | { list: string; listType: string }): void;
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

export function YouTubePlayer({ videoId, playlistId, onEnded, onStateChange }: YouTubePlayerProps) {
  const playerRef = useRef<YT.Player | null>(null);
  const expectedVideoIdRef = useRef<string | null>(null);
  const playlistModeRef = useRef(false);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const containerIdRef = useRef('yt-player-' + Math.random().toString(36).slice(2, 9));
  const onEndedRef = useRef(onEnded);
  const onStateChangeRef = useRef(onStateChange);

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

            if (state === 0 /* ENDED */) {
              clearProgressInterval();
              // Only fire onEnded for queue songs (not playlist — YouTube auto-advances those)
              if (expectedVideoIdRef.current && !playlistModeRef.current) {
                onEndedRef.current();
              }
            } else if (state === 1 /* PLAYING */) {
              startProgressInterval();
            } else if (state === 2 /* PAUSED */) {
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

  // Handle videoId changes (queue songs override playlist)
  useEffect(() => {
    expectedVideoIdRef.current = videoId;
    if (videoId) {
      playlistModeRef.current = false;
      const player = playerRef.current;
      if (player) {
        try {
          player.loadVideoById(videoId);
        } catch {
          // Player may not be initialized yet; onReady will handle it
        }
      }
    }
  }, [videoId]);

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
        player.loadPlaylist({ list: playlistId, listType: 'playlist' });
      } catch {
        // Player may not be ready
      }
    }
  }, [playlistId, videoId, clearProgressInterval]);

  return (
    <div className="w-full aspect-video bg-black rounded-lg overflow-hidden">
      <div id={containerIdRef.current} />
    </div>
  );
}
