'use client';

import { useMemo, useRef, useCallback, useEffect, useState } from 'react';

interface QueueItem {
  requestId: string;
  songId: string;
  title: string;
  artist: string;
  spotifyId?: string;
}

interface SpotifyPlayback {
  isPlaying: boolean;
  currentTrack: {
    serviceId: string;
    service: string;
    title: string;
    artist: string;
    albumArtUrl?: string;
    durationMs?: number;
  } | null;
  progressMs: number;
  durationMs: number;
  deviceId?: string;
}

interface UseSpotifyOrchestratorOptions {
  queue: QueueItem[];
  sessionId: string | null;
  venueId: string;
  adminToken: string;
  spotifyDeviceId: string | null;
  streamingService: string | null;
  onAdvanceQueue: (requestId?: string) => Promise<void>;
}

export function useSpotifyOrchestrator({
  queue,
  sessionId,
  venueId,
  adminToken,
  spotifyDeviceId,
  streamingService,
  onAdvanceQueue,
}: UseSpotifyOrchestratorOptions) {
  const isAdvancingRef = useRef(false);
  const lastHeartbeatRef = useRef(0);
  const lockedRequestIdRef = useRef<string | null>(null);
  const lastPlayedTrackRef = useRef<string | null>(null);
  const [spotifyPlayback, setSpotifyPlayback] = useState<SpotifyPlayback | null>(null);

  const isSpotifyActive = streamingService === 'spotify' && !!spotifyDeviceId && !!sessionId;

  // Lock onto the currently playing queue song — same pattern as usePlayerOrchestrator
  const currentQueueSong = useMemo(() => {
    if (queue.length === 0) return null;

    if (lockedRequestIdRef.current) {
      const locked = queue.find((q) => q.requestId === lockedRequestIdRef.current);
      if (locked) return locked;
    }

    return queue[0];
  }, [queue]);

  // Keep the lock ref in sync and immediately report to server
  useEffect(() => {
    lockedRequestIdRef.current = currentQueueSong?.requestId ?? null;

    if (sessionId && venueId && adminToken && currentQueueSong?.requestId) {
      fetch(`/api/admin/${venueId}/playback-state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminPassword: adminToken,
          nowPlayingRequestId: currentQueueSong.requestId,
          state: { isPlaying: true, progressMs: 0, durationMs: 0 },
        }),
      }).catch(() => { /* ignore */ });
    }
  }, [currentQueueSong?.requestId, sessionId, venueId, adminToken]);

  // Play trigger: when currentQueueSong changes and has a spotifyId, play it
  useEffect(() => {
    if (!isSpotifyActive) return;
    if (!currentQueueSong?.spotifyId) return;

    const trackKey = `${currentQueueSong.requestId}:${currentQueueSong.spotifyId}`;
    if (lastPlayedTrackRef.current === trackKey) return;
    lastPlayedTrackRef.current = trackKey;

    fetch(`/api/admin/${venueId}/playback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        adminPassword: adminToken,
        action: 'play',
        trackId: currentQueueSong.spotifyId,
        deviceId: spotifyDeviceId,
      }),
    }).catch((err) => {
      console.error('[useSpotifyOrchestrator] Play failed:', err);
    });
  }, [isSpotifyActive, currentQueueSong?.requestId, currentQueueSong?.spotifyId, venueId, adminToken, spotifyDeviceId]);

  // Polling loop: check Spotify playback state every 4s, detect track end
  useEffect(() => {
    if (!isSpotifyActive) return;

    const poll = async () => {
      try {
        const res = await fetch(`/api/admin/${venueId}/playback`, {
          headers: { 'x-admin-password': adminToken },
        });
        if (!res.ok) return;

        const data = await res.json();
        const playback: SpotifyPlayback | null = data.playback ?? null;
        setSpotifyPlayback(playback);

        if (!playback) return;

        // Heartbeat: report current playback state to server (throttled to 5s)
        const now = Date.now();
        if (now - lastHeartbeatRef.current >= 5000 && currentQueueSong) {
          lastHeartbeatRef.current = now;
          fetch(`/api/admin/${venueId}/playback-state`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              adminPassword: adminToken,
              nowPlayingRequestId: currentQueueSong.requestId,
              state: {
                isPlaying: playback.isPlaying,
                progressMs: playback.progressMs,
                durationMs: playback.durationMs,
                currentTrack: playback.currentTrack,
              },
            }),
          }).catch(() => { /* ignore */ });
        }

        // Detect track ending: not playing and progress is near duration (< 3s remaining)
        if (
          !playback.isPlaying &&
          playback.durationMs > 0 &&
          playback.progressMs > 0 &&
          (playback.durationMs - playback.progressMs) < 3000 &&
          currentQueueSong &&
          !isAdvancingRef.current
        ) {
          isAdvancingRef.current = true;
          try {
            await onAdvanceQueue(currentQueueSong.requestId);
          } finally {
            isAdvancingRef.current = false;
          }
        }
      } catch (err) {
        console.error('[useSpotifyOrchestrator] Poll failed:', err);
      }
    };

    const interval = setInterval(poll, 4000);
    // Run immediately on mount
    poll();
    return () => clearInterval(interval);
  }, [isSpotifyActive, venueId, adminToken, currentQueueSong, onAdvanceQueue]);

  const handleSpotifySkip = useCallback(async () => {
    if (!currentQueueSong || isAdvancingRef.current) return;
    isAdvancingRef.current = true;
    try {
      await onAdvanceQueue(currentQueueSong.requestId);
    } finally {
      isAdvancingRef.current = false;
    }
  }, [currentQueueSong, onAdvanceQueue]);

  return {
    isSpotifyActive,
    spotifyPlayback,
    currentSpotifySong: currentQueueSong,
    handleSpotifySkip,
  };
}
