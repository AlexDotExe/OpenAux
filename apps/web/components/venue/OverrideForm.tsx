'use client';

import { useState } from 'react';
import type { Track } from '@openaux/shared';

import { ApiClientError, getApiClient, type AuthContext } from '../../lib/api';
import { TrackSearch } from '../TrackSearch';

export interface OverrideFormProps {
  venueId: string;
  auth: AuthContext;
}

export function OverrideForm({ venueId, auth }: OverrideFormProps) {
  const [selected, setSelected] = useState<Track | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const play = async (when: 'now' | 'next') => {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    setOk(null);
    try {
      await getApiClient().createOverride(
        venueId,
        { providerTrackId: selected.providerTrackId, when },
        auth,
      );
      setOk(`${selected.title} will play ${when === 'now' ? 'now' : 'next'}.`);
      setSelected(null);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not override.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="card stack">
      <strong>Override / manual play</strong>
      {selected ? (
        <div className="stack">
          <div className="track-row">
            <div className="track-meta">
              <div className="track-title">{selected.title}</div>
              <div className="track-artist">{selected.artist}</div>
            </div>
            <button className="btn btn-sm" onClick={() => setSelected(null)}>
              Change
            </button>
          </div>
          <div className="row">
            <button className="btn btn-primary" onClick={() => play('now')} disabled={submitting}>
              Play now
            </button>
            <button className="btn" onClick={() => play('next')} disabled={submitting}>
              Play next
            </button>
          </div>
        </div>
      ) : (
        <TrackSearch venueId={venueId} onSelect={setSelected} selectLabel="Choose" />
      )}
      {error && <p className="error-text">{error}</p>}
      {ok && <p className="helper-text">{ok}</p>}
    </div>
  );
}
