'use client';

/**
 * Shared song search box — GET /api/venues/:venueId/search?q=.
 * Used by the patron request flow and by the venue console (override /
 * fallback playlist / anthem pickers), so it just returns the chosen Track
 * via onSelect and lets the caller decide what happens next.
 */

import { useEffect, useRef, useState } from 'react';
import type { Track } from '@openaux/shared';

import { ApiClientError, getApiClient } from '../lib/api';
import { formatDuration } from '../lib/format';

export interface TrackSearchProps {
  venueId: string;
  onSelect: (track: Track) => void;
  selectLabel?: string;
  placeholder?: string;
}

export function TrackSearch({
  venueId,
  onSelect,
  selectLabel = 'Select',
  placeholder = 'Search songs or artists…',
}: TrackSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setError(null);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(() => {
      getApiClient()
        .search(venueId, trimmed)
        .then((res) => {
          setResults(res.tracks);
          setError(null);
        })
        .catch((e) => {
          setError(e instanceof ApiClientError ? e.message : 'Search failed.');
        })
        .finally(() => setLoading(false));
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, venueId]);

  return (
    <div className="stack">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        aria-label="Search songs"
      />
      {loading && <p className="helper-text">Searching…</p>}
      {error && <p className="error-text">{error}</p>}
      {results.length > 0 && (
        <div className="card">
          {results.map((track) => (
            <div className="track-row" key={track.providerTrackId}>
              <div className="track-meta">
                <div className="track-title">{track.title}</div>
                <div className="track-artist">
                  {track.artist} · {formatDuration(track.durationMs)}
                  {track.explicit ? ' · Explicit' : ''}
                </div>
              </div>
              <button className="btn btn-sm" onClick={() => onSelect(track)}>
                {selectLabel}
              </button>
            </div>
          ))}
        </div>
      )}
      {!loading && !error && query.trim() && results.length === 0 && (
        <p className="helper-text">No songs found for &ldquo;{query}&rdquo;.</p>
      )}
    </div>
  );
}
