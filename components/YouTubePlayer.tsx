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
          if (event.data === window.YT.PlayerState.ENDED) {
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
    if (playerRef.current && videoId) {
      playerRef.current.loadVideoById(videoId);
    }
  }, [videoId]);

  return (
    <div className="rounded-xl overflow-hidden bg-black">
      <div id={containerRef.current} />
    </div>
  );
}
