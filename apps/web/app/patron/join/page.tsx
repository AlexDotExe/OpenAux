'use client';

/**
 * Patron join screen — consumes /patron/join?token=... from the venue's QR code
 * and calls POST /api/sessions/join. Manual token entry keeps it demoable
 * without a camera.
 *
 * Sign-in is optional by design (SPEC.md §4): guests can always join. Signing in
 * with Google carries an ID token through as `authToken` so the session is bound
 * to a real account (reputation, saved stats, premium).
 */

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { ApiClientError, getApiClient } from '../../../lib/api';
import { savePatronSession } from '../../../lib/session';
import { GoogleSignInButton } from '../../../components/GoogleSignInButton';

function JoinForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [token, setToken] = useState(searchParams.get('token') ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signInEnabled = Boolean(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID);

  const join = async (authToken?: string) => {
    const code = token.trim();
    if (!code) {
      setError('Enter the venue join code first.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await getApiClient().joinSession({
        venueQrToken: code,
        ...(authToken ? { authToken } : {}),
      });
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
        <span className="brand">
          Open<em>Aux</em>
        </span>
      </div>

      <div className="stack" style={{ gap: 6, marginBottom: 6 }}>
        <h1 style={{ fontSize: '2rem', lineHeight: 1.1 }}>
          You&rsquo;re the <span style={{ color: 'var(--accent)' }}>DJ</span> tonight.
        </h1>
        <p className="helper-text" style={{ fontSize: '0.95rem' }}>
          Scan the venue&rsquo;s QR code or enter its join code. Request songs, vote on the queue,
          and hear the room decide.
        </p>
      </div>

      <div className="card card--raised stack">
        <label className="field">
          <span>Venue join code</span>
          <input
            type="text"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="e.g. 0X-OaiXUa997"
            aria-label="Venue join code"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>

        <button
          className="btn btn-primary btn-block"
          onClick={() => void join()}
          disabled={loading}
        >
          {loading ? 'Joining…' : 'Join as guest'}
        </button>

        {/* Only offer sign-in when a provider is actually configured, so an
            unconfigured deploy shows a clean guest-only card rather than an
            empty divider. */}
        {signInEnabled && (
          <>
            <div className="divider">or</div>
            <GoogleSignInButton disabled={loading} onCredential={(idToken) => void join(idToken)} />
            <p className="helper-text" style={{ textAlign: 'center' }}>
              Signing in saves your stats and reputation across venues. Guests can do everything
              except carry history between nights.
            </p>
          </>
        )}

        {error && <p className="error-text">{error}</p>}
      </div>
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
