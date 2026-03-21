'use client';

import { useMemo, useRef, useCallback, useEffect } from 'react';

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
  const lockedRequestIdRef = useRef<string | null>(null);

  // Lock onto the currently playing queue song. Only switch when the locked
  // song is removed from the queue (advance, skip, play-now) or the queue empties.
  const currentQueueSong = useMemo(() => {
    if (queue.length === 0) return null;

    // If we have a locked song and it's still in the queue, keep it
    if (lockedRequestIdRef.current) {
      const locked = queue.find((q) => q.requestId === lockedRequestIdRef.current);
      if (locked) return locked;
    }

    // No lock yet, or locked song was removed — pick queue[0]
    return queue[0];
  }, [queue]);

  // Keep the lock ref in sync (side-effect after render)
  useEffect(() => {
    lockedRequestIdRef.current = currentQueueSong?.requestId ?? null;
  }, [currentQueueSong?.requestId]);

  const queueVideoId = currentQueueSong?.youtubeId ?? null;

  const { currentVideoId, currentTrackInfo, activePlaylistId } = useMemo(() => {
    if (queueVideoId && currentQueueSong) {
      return {
        currentVideoId: queueVideoId,
        currentTrackInfo: { title: currentQueueSong.title, artist: currentQueueSong.artist, source: 'queue' as const },
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
  }, [queueVideoId, currentQueueSong, youtubePlaylistId, streamingService]);

  // Only called for queue songs (playlist advancement is handled natively by YouTube)
  const handleTrackEnded = useCallback(async () => {
    if (isAdvancingRef.current) return;
    if (!currentQueueSong) return;
    isAdvancingRef.current = true;
    try {
      await onAdvanceQueue(currentQueueSong.requestId);
    } finally {
      isAdvancingRef.current = false;
    }
  }, [currentQueueSong, onAdvanceQueue]);

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
