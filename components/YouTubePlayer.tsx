'use client';

import { useEffect, useRef, useCallback } from 'react';

interface YouTubePlayerProps {
  videoId: string;
  onEnded?: () => void;
  onStateChange?: (state: { isPlaying: boolean; progressMs: number; durationMs: number }) => void;
}

declare global {
  interface Window {
    YT: {
      Player: new (
        elementId: string,
        config: {
          height: string;
          width: string;
          videoId: string;
          playerVars: Record<string, number>;
          events: Record<string, (event: { data: number; target: { getDuration: () => number; getCurrentTime: () => number } }) => void>;
        },
      ) => YTPlayer;
      PlayerState: { ENDED: number; PLAYING: number; PAUSED: number };
    };
    onYouTubeIframeAPIReady: () => void;
  }
}

interface YTPlayer {
  playVideo: () => void;
  pauseVideo: () => void;
  loadVideoById: (videoId: string) => void;
  destroy: () => void;
  getDuration: () => number;
  getCurrentTime: () => number;
  getPlayerState: () => number;
}

export function YouTubePlayer({ videoId, onEnded, onStateChange }: YouTubePlayerProps) {
  const playerRef = useRef<YTPlayer | null>(null);
  const containerRef = useRef<string>(`yt-player-${Math.random().toString(36).slice(2)}`);

  const initPlayer = useCallback(() => {
    if (!window.YT?.Player) return;

    playerRef.current = new window.YT.Player(containerRef.current, {
      height: '240',
      width: '100%',
      videoId,
      playerVars: { autoplay: 1, controls: 1, modestbranding: 1 },
      events: {
        onStateChange: (event) => {
          const stateNames: Record<number, string> = {
            [-1]: 'UNSTARTED',
            [0]: 'ENDED',
            [1]: 'PLAYING',
            [2]: 'PAUSED',
            [3]: 'BUFFERING',
            [5]: 'CUED',
          };
          console.log('[YouTubePlayer] State changed to:', stateNames[event.data] ?? event.data);

          if (event.data === window.YT.PlayerState.ENDED) {
            console.log('[YouTubePlayer] Video ended, calling onEnded');
            onEnded?.();
          }
          if (onStateChange) {
            const isPlaying = event.data === window.YT.PlayerState.PLAYING;
            onStateChange({
              isPlaying,
              progressMs: (event.target.getCurrentTime?.() ?? 0) * 1000,
              durationMs: (event.target.getDuration?.() ?? 0) * 1000,
            });
          }
        },
      },
    });
  }, [videoId, onEnded, onStateChange]);

  useEffect(() => {
    // Load YouTube iFrame API if not already loaded
    if (window.YT?.Player) {
      initPlayer();
      return;
    }

    const existingScript = document.querySelector('script[src*="youtube.com/iframe_api"]');
    if (!existingScript) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
    }

    window.onYouTubeIframeAPIReady = initPlayer;

    return () => {
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [initPlayer]);

  // Load new video when videoId changes
  useEffect(() => {
    if (playerRef.current && videoId && typeof playerRef.current.loadVideoById === 'function') {
      console.log('[YouTubePlayer] Loading new video:', videoId);
      playerRef.current.loadVideoById(videoId);
      // Explicitly start playback after a short delay, but only if not already playing
      setTimeout(() => {
        if (playerRef.current && typeof playerRef.current.getPlayerState === 'function') {
          const state = playerRef.current.getPlayerState();
          // Only auto-play if the player is not already playing (1) or buffering (3)
          if (state !== window.YT.PlayerState.PLAYING && state !== 3) {
            console.log('[YouTubePlayer] Auto-starting playback for:', videoId, 'from state:', state);
            if (typeof playerRef.current.playVideo === 'function') {
              playerRef.current.playVideo();
            }
          } else {
            console.log('[YouTubePlayer] Skipping auto-play, already playing or buffering:', videoId, 'state:', state);
          }
        }
      }, 500);
    }
  }, [videoId]);

  return (
    <div className="rounded-xl overflow-hidden bg-black">
      <div id={containerRef.current} />
    </div>
  );
}
