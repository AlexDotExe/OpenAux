'use client';

import { useState } from 'react';
import type { Track } from '@openaux/shared';

import { ApiClientError, getApiClient, type AuthContext } from '../../lib/api';
import { TrackSearch } from '../TrackSearch';

export interface RequestSongPanelProps {
  venueId: string;
  auth: AuthContext;
  onRequested: () => void;
}

export function RequestSongPanel({ venueId, auth, onRequested }: RequestSongPanelProps) {
  const [status, setStatus] = useState<
    { kind: 'idle' } | { kind: 'error'; message: string } | { kind: 'ok'; title: string }
  >({
    kind: 'idle',
  });

  const handleSelect = async (track: Track) => {
    setStatus({ kind: 'idle' });
    try {
      await getApiClient().createRequest(venueId, { providerTrackId: track.providerTrackId }, auth);
      setStatus({ kind: 'ok', title: track.title });
      onRequested();
    } catch (e) {
      setStatus({
        kind: 'error',
        message: e instanceof ApiClientError ? e.message : 'Could not request that song.',
      });
    }
  };

  return (
    <div className="stack">
      <TrackSearch venueId={venueId} onSelect={handleSelect} selectLabel="Request" />
      {status.kind === 'error' && <p className="error-text">{status.message}</p>}
      {status.kind === 'ok' && (
        <p className="helper-text">Requested &ldquo;{status.title}&rdquo; 🎶</p>
      )}
    </div>
  );
}
