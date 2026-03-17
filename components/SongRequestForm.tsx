'use client';

import { useState, useEffect, useRef } from 'react';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { SongSearchResults } from './SongSearchResults';

interface Props {
  sessionId: string;
  venueId?: string;
  onRequestSubmitted: (queue?: any[]) => void;
}

interface SearchResultItem {
  serviceId?: string;
  service?: 'spotify' | 'youtube';
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
  const [showManual, setShowManual] = useState(false);
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [loading, setLoading] = useState(false);
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

  const submitRequest = async (data: {
    title: string;
    artist: string;
    spotifyId?: string;
    youtubeId?: string;
    albumArtUrl?: string;
    durationMs?: number;
  }) => {
    if (!userId) return;
    setLoading(true);
    setError(null);

    const res = await fetch('/api/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, userId, ...data }),
    });

    const resData = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(resData.error ?? 'Failed to submit request');
      if (resData.cooldownRemainingSeconds) {
        setCooldownEndsAt(Date.now() + resData.cooldownRemainingSeconds * 1000);
      }
    } else {
      setSuccess(true);
      setQuery('');
      setResults([]);
      setTitle('');
      setArtist('');
      setShowManual(false);
      // Pass the updated queue to immediately update UI
      onRequestSubmitted(resData.queue);
      setTimeout(() => setSuccess(false), 3000);
    }
  };

  const handleSelect = (result: SearchResultItem) => {
    const spotifyId = result.serviceId && result.service === 'spotify'
      ? result.serviceId
      : (result.spotifyId ?? undefined);
    const youtubeId = result.serviceId && result.service === 'youtube'
      ? result.serviceId
      : (result.youtubeId ?? undefined);

    submitRequest({
      title: result.title,
      artist: result.artist,
      spotifyId,
      youtubeId,
      albumArtUrl: result.albumArtUrl ?? undefined,
      durationMs: result.durationMs ?? undefined,
    });
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !artist) return;
    submitRequest({ title, artist });
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

      {!showManual ? (
        <>
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

          {/* Manual entry fallback */}
          <button
            onClick={() => setShowManual(true)}
            disabled={isCoolingDown}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Can&apos;t find it? Enter manually
          </button>
        </>
      ) : (
        <>
          {/* Manual entry form */}
          <form onSubmit={handleManualSubmit} className="space-y-3">
            <input
              type="text"
              placeholder="Song title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              disabled={isCoolingDown}
              className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 text-sm placeholder-gray-500 outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <input
              type="text"
              placeholder="Artist name"
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
              required
              disabled={isCoolingDown}
              className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 text-sm placeholder-gray-500 outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <button
              type="submit"
              disabled={loading || !title || !artist || isCoolingDown}
              className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-semibold py-2 rounded-lg transition-colors disabled:cursor-not-allowed"
            >
              {loading ? 'Submitting...' : isCoolingDown ? `Wait ${cooldownDisplay}` : 'Request Song'}
            </button>
          </form>
          <button
            onClick={() => setShowManual(false)}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            Back to search
          </button>
        </>
      )}

      {error && <p className="text-red-400 text-sm">{error}</p>}
      {success && <p className="text-green-400 text-sm">Request submitted!</p>}
      {loading && !showManual && <p className="text-gray-400 text-sm animate-pulse">Submitting...</p>}
    </div>
  );
}
