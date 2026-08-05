'use client';

/** Silence-fallback playlist: what plays when the live queue runs dry
 * (SPEC.md §5 "silent-queue fallback" — the room is never silent, D3). */

import { useState } from 'react';
import type { Track } from '@openaux/shared';

import { ApiClientError, getApiClient, type AuthContext } from '../../lib/api';
import { TrackSearch } from '../TrackSearch';

export interface FallbackPlaylistEditorProps {
  venueId: string;
  auth: AuthContext;
  initialTracks: Track[];
}

export function FallbackPlaylistEditor({
  venueId,
  auth,
  initialTracks,
}: FallbackPlaylistEditorProps) {
  const [tracks, setTracks] = useState<Track[]>(initialTracks);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const save = async (next: Track[]) => {
    setTracks(next);
    setSaving(true);
    setError(null);
    try {
      await getApiClient().setFallbackPlaylist(
        venueId,
        { providerTrackIds: next.map((t) => t.providerTrackId) },
        auth,
      );
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not save fallback playlist.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card stack">
      <strong>Fallback playlist</strong>
      <p className="helper-text">Plays when the live queue is empty — the room is never silent.</p>
      {tracks.length === 0 ? (
        <p className="empty-state">No fallback songs set.</p>
      ) : (
        tracks.map((t) => (
          <div className="track-row" key={t.providerTrackId}>
            <div className="track-meta">
              <div className="track-title">{t.title}</div>
              <div className="track-artist">{t.artist}</div>
            </div>
            <button
              className="btn btn-sm"
              onClick={() => save(tracks.filter((x) => x.providerTrackId !== t.providerTrackId))}
              disabled={saving}
            >
              Remove
            </button>
          </div>
        ))
      )}
      {adding ? (
        <TrackSearch
          venueId={venueId}
          selectLabel="Add"
          onSelect={(t) => {
            if (!tracks.some((x) => x.providerTrackId === t.providerTrackId)) save([...tracks, t]);
            setAdding(false);
          }}
        />
      ) : (
        <button className="btn" onClick={() => setAdding(true)}>
          Add song
        </button>
      )}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
