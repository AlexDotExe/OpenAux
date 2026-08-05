'use client';

import { useState } from 'react';
import type { VenueControlMode } from '@openaux/shared';

import { ApiClientError, getApiClient, type AuthContext } from '../../lib/api';

export interface ControlModeToggleProps {
  venueId: string;
  controlMode: VenueControlMode;
  auth: AuthContext;
  onChanged: (mode: VenueControlMode) => void;
}

export function ControlModeToggle({
  venueId,
  controlMode,
  auth,
  onChanged,
}: ControlModeToggleProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setMode = async (mode: VenueControlMode) => {
    if (mode === controlMode) return;
    setSaving(true);
    setError(null);
    try {
      await getApiClient().updateVenueSettings(venueId, { controlMode: mode }, auth);
      onChanged(mode);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not change control mode.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card stack">
      <strong>Control mode</strong>
      <div className="row">
        <button
          className={`btn${controlMode === 'crowd' ? ' btn-primary' : ''}`}
          onClick={() => setMode('crowd')}
          disabled={saving}
        >
          Crowd control
        </button>
        <button
          className={`btn${controlMode === 'suggestion' ? ' btn-primary' : ''}`}
          onClick={() => setMode('suggestion')}
          disabled={saving}
        >
          Suggestion mode
        </button>
      </div>
      <p className="helper-text">
        {controlMode === 'crowd'
          ? 'Crowd-run — the queue plays automatically; you can override any time.'
          : 'Every request needs your approval before it enters the queue.'}
      </p>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
