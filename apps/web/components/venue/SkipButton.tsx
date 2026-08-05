'use client';

import { useState } from 'react';

import { ApiClientError, getApiClient, type AuthContext } from '../../lib/api';

export interface SkipButtonProps {
  venueId: string;
  auth: AuthContext;
  nowPlayingTitle: string | null;
}

export function SkipButton({ venueId, auth, nowPlayingTitle }: SkipButtonProps) {
  const [skipping, setSkipping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSkip = async () => {
    setSkipping(true);
    setError(null);
    try {
      await getApiClient().skip(venueId, auth);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not skip.');
    } finally {
      setSkipping(false);
    }
  };

  return (
    <div className="card stack">
      <strong>Now playing</strong>
      <p className="helper-text">{nowPlayingTitle ?? 'Nothing playing'}</p>
      <button
        className="btn btn-danger btn-block"
        onClick={handleSkip}
        disabled={skipping || !nowPlayingTitle}
      >
        {skipping ? 'Skipping…' : 'Skip current song'}
      </button>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
