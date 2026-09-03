'use client';

/**
 * Power Hour Mode controls (SPEC.md §5 V1): the venue picks a genre, a vote
 * multiplier, and a duration, then activates a boost window from drink totals
 * (e.g. "Hip-Hop ×2 for 15 min"). Shows the live "🔥 Power Hour" banner +
 * countdown while a window is active, driven by the current PowerHourState.
 */

import { useState } from 'react';
import type { PowerHourState } from '@openaux/shared';

import { ApiClientError, getApiClient, type AuthContext } from '../../lib/api';
import { PowerHourBanner } from '../PowerHourBanner';

const GENRE_OPTIONS = ['hip-hop', 'pop', 'dance', 'disco', 'reggaeton', 'latin', 'indie', 'funk'];
const MULTIPLIER_OPTIONS = [2, 3];
const DURATION_OPTIONS = [15, 30, 60];

export interface PowerHourControlsProps {
  venueId: string;
  auth: AuthContext;
  /** The venue's currently-active Power Hour window, or null when none. */
  active: PowerHourState | null;
  onActivated: (powerHour: PowerHourState) => void;
}

export function PowerHourControls({ venueId, auth, active, onActivated }: PowerHourControlsProps) {
  const [genre, setGenre] = useState(GENRE_OPTIONS[0]!);
  const [multiplier, setMultiplier] = useState(MULTIPLIER_OPTIONS[0]!);
  const [durationMinutes, setDurationMinutes] = useState(DURATION_OPTIONS[0]!);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activate = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await getApiClient().activatePowerHour(
        venueId,
        { genre, multiplier, durationMinutes },
        auth,
      );
      onActivated(res.powerHour);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not activate Power Hour.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card stack">
      <strong>Power Hour Mode</strong>
      <p className="helper-text">
        Boost a genre from drink totals — e.g. Hip-Hop ×2 votes for 15 min.
      </p>

      {active && (
        <PowerHourBanner
          genre={active.genre}
          multiplier={active.multiplier}
          endsAt={active.endsAt}
        />
      )}

      <label className="row row--between">
        Genre
        <select value={genre} onChange={(e) => setGenre(e.target.value)}>
          {GENRE_OPTIONS.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </label>
      <label className="row row--between">
        Multiplier
        <select value={multiplier} onChange={(e) => setMultiplier(Number(e.target.value))}>
          {MULTIPLIER_OPTIONS.map((m) => (
            <option key={m} value={m}>
              ×{m}
            </option>
          ))}
        </select>
      </label>
      <label className="row row--between">
        Duration
        <select
          value={durationMinutes}
          onChange={(e) => setDurationMinutes(Number(e.target.value))}
        >
          {DURATION_OPTIONS.map((d) => (
            <option key={d} value={d}>
              {d} min
            </option>
          ))}
        </select>
      </label>

      <button className="btn btn-primary" onClick={activate} disabled={saving}>
        {saving ? 'Activating…' : active ? 'Replace active Power Hour' : 'Activate Power Hour'}
      </button>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
