'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

interface Props {
  trackId: string | null;
  onTrackEnded?: () => void;
}

interface EmbedController {
  loadUri: (uri: string) => void;
  play: () => void;
  togglePlay: () => void;
  seek: (seconds: number) => void;
  destroy: () => void;
  addListener: (event: string, callback: (e: unknown) => void) => void;
  removeListener: (event: string, callback: (e: unknown) => void) => void;
}

interface IFrameAPI {
  createController: (
    el: HTMLElement,
    options: { uri?: string; width?: string | number; height?: number },
    callback: (controller: EmbedController) => void,
  ) => void;
}

interface PlaybackUpdateEvent {
  data: {
    isPaused: boolean;
    isBuffering: boolean;
    position: number;
    duration: number;
  };
}

declare global {
  interface Window {
    onSpotifyIframeApiReady?: (api: IFrameAPI) => void;
  }
}

export function SpotifyEmbeddedPlayer({ trackId, onTrackEnded }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<EmbedController | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trackEndedRef = useRef(false);
  const onTrackEndedRef = useRef(onTrackEnded);

  // Keep callback ref up to date
  useEffect(() => {
    onTrackEndedRef.current = onTrackEnded;
  }, [onTrackEnded]);

  // Load Spotify IFrame API and create controller
  useEffect(() => {
    if (!containerRef.current) return;

    let destroyed = false;

    const initController = (IFrameAPI: IFrameAPI) => {
      if (destroyed || !containerRef.current) return;

      const initialUri = trackId ? `spotify:track:${trackId}` : undefined;

      IFrameAPI.createController(
        containerRef.current,
        { uri: initialUri, width: '100%', height: 152 },
        (controller) => {
          if (destroyed) {
            controller.destroy();
            return;
          }

          controllerRef.current = controller;
          setIsReady(true);
          setError(null);

          controller.addListener('playback_update', (e: unknown) => {
            const event = e as PlaybackUpdateEvent;
            const { isPaused, duration, position } = event.data;

            // Detect track end: position near end and paused
            if (
              duration > 0 &&
              position >= duration - 1 &&
              isPaused &&
              !trackEndedRef.current
            ) {
              trackEndedRef.current = true;
              console.log('[SpotifyEmbed] Track ended');
              onTrackEndedRef.current?.();
            }
          });
        },
      );
    };

    // Check if the API is already loaded (script may already be on page)
    if (typeof window.onSpotifyIframeApiReady === 'function') {
      // API script already loaded but callback may have fired – re-trigger isn't
      // possible, so we inject a fresh script to be safe.
    }

    // Load the Spotify IFrame API script
    const existingScript = document.querySelector(
      'script[src="https://open.spotify.com/embed/iframe-api/v1"]',
    );
    if (!existingScript) {
      const script = document.createElement('script');
      script.src = 'https://open.spotify.com/embed/iframe-api/v1';
      script.async = true;
      script.onerror = () => setError('Failed to load Spotify embed player');
      document.body.appendChild(script);
    }

    window.onSpotifyIframeApiReady = (IFrameAPI: IFrameAPI) => {
      initController(IFrameAPI);
    };

    return () => {
      destroyed = true;
      controllerRef.current?.destroy();
      controllerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update track when trackId changes
  const loadTrack = useCallback(
    (id: string) => {
      if (controllerRef.current) {
        trackEndedRef.current = false;
        controllerRef.current.loadUri(`spotify:track:${id}`);
      }
    },
    [],
  );

  useEffect(() => {
    if (trackId && isReady) {
      loadTrack(trackId);
    }
  }, [trackId, isReady, loadTrack]);

  if (error) {
    return (
      <div className="bg-red-900/20 border border-red-700 rounded-xl p-4">
        <h2 className="font-semibold mb-2">Spotify Player Error</h2>
        <p className="text-sm text-red-400">{error}</p>
      </div>
    );
  }

  if (!trackId) {
    return (
      <div className="bg-gray-900 rounded-xl p-4">
        <h2 className="font-semibold mb-2">Spotify Player</h2>
        <p className="text-gray-500 text-sm">Ready to play. Advance the queue to start.</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 rounded-xl overflow-hidden">
      <div ref={containerRef} />
      {!isReady && (
        <div className="p-4">
          <p className="text-gray-400 text-sm animate-pulse">Loading Spotify player...</p>
        </div>
      )}
    </div>
  );
}
