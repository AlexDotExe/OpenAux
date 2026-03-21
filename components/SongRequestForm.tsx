'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { SongSearchResults } from './SongSearchResults';

const MAX_RETRIES = 3;

interface Props {
  sessionId: string;
  venueId?: string;
  onRequestSubmitted: (queue?: any[]) => void;
}

interface SearchResultItem {
  serviceId?: string;
  service?: 'spotify' | 'youtube';
  source?: 'itunes';
  id?: string;
  spotifyId?: string | null;
  youtubeId?: string | null;
  title: string;
  artist: string;
  albumArtUrl?: string | null;
  durationMs?: number | null;
}

export function SongRequestForm({ sessionId, venueId, onRequestSubmitted }: Props) {
  const { userId } = useSessionStore();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [cooldownEndsAt, setCooldownEndsAt] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Start/restart the countdown whenever cooldownEndsAt changes
  useEffect(() => {
    if (cooldownRef.current) {
      clearInterval(cooldownRef.current);
      cooldownRef.current = null;
    }

    if (!cooldownEndsAt) {
      setCooldownSeconds(0);
      return;
    }

    const tick = () => {
      const remaining = Math.ceil((cooldownEndsAt - Date.now()) / 1000);
      if (remaining <= 0) {
        setCooldownSeconds(0);
        clearInterval(cooldownRef.current!);
        cooldownRef.current = null;
      } else {
        setCooldownSeconds(remaining);
      }
    };

    tick();
    cooldownRef.current = setInterval(tick, 1000);

    return () => {
      if (cooldownRef.current) {
        clearInterval(cooldownRef.current);
        cooldownRef.current = null;
      }
    };
  }, [cooldownEndsAt]);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query || query.length < 2) {
      setResults([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const params = new URLSearchParams({ q: query });
        if (venueId) params.set('venueId', venueId);
        const res = await fetch(`/api/songs/search?${params}`);
        const data = await res.json();
        setResults(data.results ?? []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, venueId]);

  /** Fire the API request in the background with automatic retries for server errors. */
  const submitInBackground = useCallback(async (
    data: {
      title: string;
      artist: string;
      spotifyId?: string;
      youtubeId?: string;
      albumArtUrl?: string;
      durationMs?: number;
    },
    tempId: string,
    attempt = 0,
  ) => {
    const store = useSessionStore.getState();
    try {
      const res = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, userId: store.userId, ...data }),
      });

      const resData = await res.json();

      if (res.ok) {
        // Server confirmed — remove optimistic tracking, next poll picks up the real entry
        useSessionStore.getState().removeOptimisticRequest(tempId);
        onRequestSubmitted();
        return;
      }

      // Non-retriable client errors (4xx)
      if (res.status < 500) {
        useSessionStore.getState().removeOptimisticRequest(tempId);
        if (resData.cooldownRemainingSeconds) {
          setCooldownEndsAt(Date.now() + resData.cooldownRemainingSeconds * 1000);
        }
        setError(resData.error ?? 'Failed to submit request');
        setSuccess(false);
        return;
      }

      // Server error — retry
      throw new Error('Server error');
    } catch {
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        return submitInBackground(data, tempId, attempt + 1);
      }
      // All retries exhausted
      useSessionStore.getState().removeOptimisticRequest(tempId);
      setError('Failed to submit request. Please try again.');
      setSuccess(false);
    }
  }, [sessionId, onRequestSubmitted]);

  /** Optimistically add the song to the queue and fire the API in the background. */
  const submitOptimistic = useCallback((data: {
    title: string;
    artist: string;
    spotifyId?: string;
    youtubeId?: string;
    albumArtUrl?: string;
    durationMs?: number;
  }) => {
    if (!userId) return;
    setError(null);

    const tempId = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Add to queue immediately
    useSessionStore.getState().addOptimisticRequest({
      requestId: tempId,
      songId: '',
      title: data.title,
      artist: data.artist,
      score: 0,
      voteCount: 0,
      durationMs: data.durationMs,
      userId,
    });

    // Clear form and show success
    setQuery('');
    setResults([]);
    setSuccess(true);
    setTimeout(() => setSuccess(false), 3000);

    // Fire API in background with retries
    submitInBackground(data, tempId);
  }, [userId, submitInBackground]);

  const handleSelect = (result: SearchResultItem) => {
    const spotifyId = result.serviceId && result.service === 'spotify'
      ? result.serviceId
      : (result.spotifyId ?? undefined);
    const youtubeId = result.serviceId && result.service === 'youtube'
      ? result.serviceId
      : (result.youtubeId ?? undefined);

    submitOptimistic({
      title: result.title,
      artist: result.artist,
      spotifyId,
      youtubeId,
      albumArtUrl: result.albumArtUrl ?? undefined,
      durationMs: result.durationMs ?? undefined,
    });
  };

  const isCoolingDown = cooldownSeconds > 0;
  const cooldownMinutes = Math.floor(cooldownSeconds / 60);
  const cooldownSecs = cooldownSeconds % 60;
  const cooldownDisplay = cooldownMinutes > 0
    ? `${cooldownMinutes}:${String(cooldownSecs).padStart(2, '0')}`
    : `${cooldownSecs}s`;

  return (
    <div className="bg-gray-900 rounded-xl p-4 space-y-3">
      <h2 className="font-semibold mb-1">🎤 Request a Song</h2>

      {isCoolingDown && (
        <div className="bg-yellow-900/40 border border-yellow-700 rounded-lg px-3 py-2 text-sm text-yellow-300">
          ⏳ Cooldown active — next request in <span className="font-mono font-semibold">{cooldownDisplay}</span>
        </div>
      )}

      {/* Search input */}
      <input
        type="text"
        placeholder="Search for a song..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        disabled={isCoolingDown}
        className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 text-sm placeholder-gray-500 outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
      />

      {/* Search results dropdown */}
      {!isCoolingDown && (
        <SongSearchResults
          results={results}
          onSelect={handleSelect}
          loading={searching}
        />
      )}

      {error && <p className="text-red-400 text-sm">{error}</p>}
      {success && <p className="text-green-400 text-sm">Request submitted!</p>}
    </div>
  );
}
