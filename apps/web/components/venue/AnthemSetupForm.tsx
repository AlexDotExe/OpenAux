'use client';

/** Venue's Anthem: attach a song to a drink special — if it wins, the promo
 * activates for N minutes (SPEC.md §5). */

import { useState } from 'react';
import type { Track } from '@openaux/shared';

import { ApiClientError, getApiClient, type AuthContext } from '../../lib/api';
import { TrackSearch } from '../TrackSearch';

export interface AnthemSetupFormProps {
  venueId: string;
  auth: AuthContext;
}

export function AnthemSetupForm({ venueId, auth }: AnthemSetupFormProps) {
  const [selected, setSelected] = useState<Track | null>(null);
  const [promoText, setPromoText] = useState('');
  const [promoDurationMinutes, setPromoDurationMinutes] = useState(5);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const save = async () => {
    if (!selected || !promoText.trim()) {
      setError('Pick a song and describe the promo.');
      return;
    }
    setSaving(true);
    setError(null);
    setOk(false);
    try {
      await getApiClient().setAnthem(
        venueId,
        {
          providerTrackId: selected.providerTrackId,
          promoText: promoText.trim(),
          promoDurationMinutes,
        },
        auth,
      );
      setOk(true);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not set anthem.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card stack">
      <strong>Venue anthem</strong>
      <p className="helper-text">
        If this song wins the queue, the promo activates for the crowd to see.
      </p>
      {selected ? (
        <div className="track-row">
          <div className="track-meta">
            <div className="track-title">{selected.title}</div>
            <div className="track-artist">{selected.artist}</div>
          </div>
          <button className="btn btn-sm" onClick={() => setSelected(null)}>
            Change
          </button>
        </div>
      ) : (
        <TrackSearch venueId={venueId} onSelect={setSelected} selectLabel="Choose" />
      )}
      <input
        type="text"
        placeholder="Promo text, e.g. $2 tequila shots for 5 min"
        value={promoText}
        onChange={(e) => setPromoText(e.target.value)}
      />
      <label className="row">
        Duration (minutes)
        <input
          type="number"
          min={1}
          max={60}
          value={promoDurationMinutes}
          onChange={(e) => setPromoDurationMinutes(Number(e.target.value) || 1)}
          style={{ width: 80 }}
        />
      </label>
      <button className="btn btn-primary" onClick={save} disabled={saving}>
        {saving ? 'Saving…' : 'Set anthem'}
      </button>
      {error && <p className="error-text">{error}</p>}
      {ok && <p className="helper-text">Anthem set 🎉</p>}
    </div>
  );
}
