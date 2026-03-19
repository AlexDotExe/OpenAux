'use client';

import { useMemo, useRef, useCallback } from 'react';

interface QueueItem {
  requestId: string;
  songId: string;
  title: string;
  artist: string;
  youtubeId?: string;
}

interface UsePlayerOrchestratorOptions {
  queue: QueueItem[];
  sessionId: string | null;
  venueId: string;
  adminToken: string;
  youtubePlaylistId: string | null;
  streamingService: string | null;
  onAdvanceQueue: (requestId?: string) => Promise<void>;
}

interface PlaybackStateUpdate {
  isPlaying: boolean;
  progressMs: number;
  durationMs: number;
}

export function usePlayerOrchestrator({
  queue,
  sessionId,
  venueId,
  adminToken,
  youtubePlaylistId,
  streamingService,
  onAdvanceQueue,
}: UsePlayerOrchestratorOptions) {
  const isAdvancingRef = useRef(false);
  const lastHeartbeatRef = useRef(0);

  // Determine what to play: queue song > YouTube playlist > idle
  const queueHead = queue[0];
  const queueVideoId = queueHead?.youtubeId ?? null;

  const { currentVideoId, currentTrackInfo, activePlaylistId } = useMemo(() => {
    if (queueVideoId) {
      return {
        currentVideoId: queueVideoId,
        currentTrackInfo: { title: queueHead.title, artist: queueHead.artist, source: 'queue' as const },
        activePlaylistId: null,
      };
    }
    // No queue song — fall back to YouTube playlist (YouTube handles advancement natively)
    if (youtubePlaylistId && streamingService === 'youtube') {
      return {
        currentVideoId: null,
        currentTrackInfo: { title: 'Playlist', artist: '', source: 'playlist' as const },
        activePlaylistId: youtubePlaylistId,
      };
    }
    return { currentVideoId: null, currentTrackInfo: null, activePlaylistId: null };
  }, [queueVideoId, queueHead?.title, queueHead?.artist, youtubePlaylistId, streamingService]);

  // Only called for queue songs (playlist advancement is handled natively by YouTube)
  const handleTrackEnded = useCallback(async () => {
    if (isAdvancingRef.current) return;
    if (!queueHead) return;
    isAdvancingRef.current = true;
    try {
      await onAdvanceQueue(queueHead.requestId);
    } finally {
      isAdvancingRef.current = false;
    }
  }, [queueHead, onAdvanceQueue]);

  const handlePlaybackState = useCallback((state: PlaybackStateUpdate) => {
    if (!sessionId || !venueId || !adminToken) return;

    const now = Date.now();
    if (now - lastHeartbeatRef.current < 5000) return;
    lastHeartbeatRef.current = now;

    const trackInfo = currentTrackInfo;
    const videoId = currentVideoId;
    if (!videoId && !activePlaylistId) return;

    fetch(`/api/admin/${venueId}/playback-state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        adminPassword: adminToken,
        state: {
          isPlaying: state.isPlaying,
          progressMs: state.progressMs,
          durationMs: state.durationMs,
          currentTrack: videoId ? {
            serviceId: videoId,
            service: 'youtube',
            title: trackInfo?.title ?? '',
            artist: trackInfo?.artist ?? '',
            durationMs: state.durationMs,
          } : null,
        },
      }),
    }).catch((err) => {
      console.error('[usePlayerOrchestrator] Heartbeat failed:', err);
    });
  }, [sessionId, venueId, adminToken, currentTrackInfo, currentVideoId, activePlaylistId]);

  return {
    currentVideoId,
    currentTrackInfo,
    activePlaylistId,
    handleTrackEnded,
    handlePlaybackState,
  };
}
