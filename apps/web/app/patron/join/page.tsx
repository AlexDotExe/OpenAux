'use client';

/**
 * Patron join screen — consumes /patron/join?token=... from the venue's QR
 * code and calls POST /api/sessions/join. Also accepts manual token entry so
 * this is demoable without an actual camera/QR scan.
 */

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { ApiClientError, getApiClient } from '../../../lib/api';
import { savePatronSession } from '../../../lib/session';

function JoinForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [token, setToken] = useState(searchParams.get('token') ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleJoin = async () => {
    if (!token.trim()) {
      setError('Enter the venue join code.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await getApiClient().joinSession({ venueQrToken: token.trim() });
      savePatronSession({
        sessionId: res.session.sessionId,
        userId: res.session.userId,
        venueId: res.venue.venueId,
        venueName: res.venue.name,
        controlMode: res.venue.controlMode,
      });
      router.push(`/patron/${res.venue.venueId}`);
    } catch (e) {
      setError(
        e instanceof ApiClientError ? e.message : 'Could not join — check the code and try again.',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="page stack">
      <div className="top-bar">
        <h1>Join a venue</h1>
      </div>
      <p className="helper-text">
        Scan the venue&rsquo;s QR code, or enter its join code below. No account needed.
      </p>
      <div className="card stack">
        <input
          type="text"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Join code"
          aria-label="Venue join code"
        />
        <button className="btn btn-primary btn-block" onClick={handleJoin} disabled={loading}>
          {loading ? 'Joining…' : 'Join session'}
        </button>
        {error && <p className="error-text">{error}</p>}
      </div>
      <p className="helper-text">
        Demo code: <code>demo-qr-token</code> (mock mode only).
      </p>
    </main>
  );
}

export default function JoinPage() {
  return (
    <Suspense fallback={<main className="page">Loading…</main>}>
      <JoinForm />
    </Suspense>
  );
}
