'use client';

/**
 * Venue owner hub: sign up / log in, then create and open venues. The login
 * returns a bearer token that authorizes every venue-admin call (console,
 * Spotify linking, playback WS) — see lib/api.ts. Opening a venue stores that
 * token under the venue id so the console page (which reads a per-venue admin
 * token) works unchanged.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MusicProviderId, VenueSummary } from '@openaux/shared';

import { ApiClientError, getApiClient } from '../../lib/api';
import {
  clearOwnerAuth,
  loadOwnerAuth,
  saveOwnerAuth,
  saveVenueAdminToken,
  type StoredOwnerAuth,
} from '../../lib/session';

export default function VenueOwnerPage() {
  const [auth, setAuth] = useState<StoredOwnerAuth | null | undefined>(undefined);

  useEffect(() => {
    setAuth(loadOwnerAuth());
  }, []);

  if (auth === undefined) {
    return (
      <main className="page stack">
        <p className="helper-text">Loading…</p>
      </main>
    );
  }

  if (!auth) {
    return <AuthForm onAuthed={setAuth} />;
  }

  return <OwnerDashboard auth={auth} onLogout={() => setAuth(null)} />;
}

function AuthForm({ onAuthed }: { onAuthed: (a: StoredOwnerAuth) => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const client = getApiClient();
      const res =
        mode === 'signup'
          ? await client.venueOwnerSignup({ email, password, displayName })
          : await client.venueOwnerLogin({ email, password });
      const stored: StoredOwnerAuth = {
        token: res.token,
        email: res.owner.email,
        displayName: res.owner.displayName,
        expiresAt: res.expiresAt,
      };
      saveOwnerAuth(stored);
      onAuthed(stored);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page stack">
      <div className="top-bar">
        <h1>Venue console</h1>
      </div>
      <div className="tab-row" role="tablist">
        <button
          className={`btn ${mode === 'login' ? 'btn-primary' : ''}`}
          role="tab"
          aria-selected={mode === 'login'}
          onClick={() => setMode('login')}
        >
          Log in
        </button>
        <button
          className={`btn ${mode === 'signup' ? 'btn-primary' : ''}`}
          role="tab"
          aria-selected={mode === 'signup'}
          onClick={() => setMode('signup')}
        >
          Sign up
        </button>
      </div>
      <div className="card stack">
        {mode === 'signup' && (
          <label className="field">
            <span>Display name</span>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="The Alibi"
              aria-label="Display name"
            />
          </label>
        )}
        <label className="field">
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="owner@bar.com"
            aria-label="Email"
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            aria-label="Password"
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </label>
        {error && <p className="error-text">{error}</p>}
        <button className="btn btn-primary btn-block" onClick={submit} disabled={busy}>
          {busy ? 'Working…' : mode === 'signup' ? 'Create account' : 'Log in'}
        </button>
      </div>
    </main>
  );
}

function OwnerDashboard({ auth, onLogout }: { auth: StoredOwnerAuth; onLogout: () => void }) {
  const router = useRouter();
  const [venues, setVenues] = useState<VenueSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [provider, setProvider] = useState<MusicProviderId>('spotify');
  const [creating, setCreating] = useState(false);

  const refresh = async () => {
    try {
      const { venues: list } = await getApiClient().venueOwnerMe(auth.token);
      setVenues(list);
    } catch (e) {
      if (e instanceof ApiClientError && e.code === 'unauthorized') {
        clearOwnerAuth();
        onLogout();
        return;
      }
      setError(e instanceof ApiClientError ? e.message : 'Could not load your venues.');
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const create = async () => {
    setError(null);
    setCreating(true);
    try {
      await getApiClient().createVenue({ name, musicProvider: provider }, auth.token);
      setName('');
      await refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not create the venue.');
    } finally {
      setCreating(false);
    }
  };

  const openConsole = (venue: VenueSummary) => {
    // The owner token is the venue admin credential; store it per venue so the
    // console page authenticates without a second login.
    saveVenueAdminToken(venue.venueId, auth.token);
    router.push(`/venue/${venue.venueId}`);
  };

  const joinUrl = (qrToken: string) =>
    typeof window !== 'undefined'
      ? `${window.location.origin}/patron/join?token=${encodeURIComponent(qrToken)}`
      : `/patron/join?token=${encodeURIComponent(qrToken)}`;

  return (
    <main className="page stack">
      <div className="top-bar">
        <h1>Your venues</h1>
        <button
          className="btn"
          onClick={() => {
            clearOwnerAuth();
            onLogout();
          }}
        >
          Log out
        </button>
      </div>
      <p className="helper-text">
        Signed in as {auth.displayName} ({auth.email})
      </p>

      {error && <p className="error-text">{error}</p>}

      <div className="card stack">
        <strong>Create a venue</strong>
        <label className="field">
          <span>Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="The Alibi"
            aria-label="Venue name"
          />
        </label>
        <label className="field">
          <span>Music provider</span>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as MusicProviderId)}
            aria-label="Music provider"
          >
            <option value="spotify">Spotify</option>
            <option value="apple_music">Apple Music</option>
          </select>
        </label>
        <button
          className="btn btn-primary btn-block"
          onClick={create}
          disabled={creating || !name.trim()}
        >
          {creating ? 'Creating…' : 'Create venue'}
        </button>
      </div>

      {venues === null ? (
        <p className="helper-text">Loading your venues…</p>
      ) : venues.length === 0 ? (
        <p className="helper-text">No venues yet — create your first one above.</p>
      ) : (
        <div className="stack">
          {venues.map((v) => (
            <div className="card stack" key={v.venueId}>
              <div className="top-bar">
                <strong>{v.name}</strong>
                <span className="pill">
                  {v.musicProvider === 'spotify' ? 'Spotify' : 'Apple Music'}
                </span>
              </div>
              <p className="helper-text">
                Patron join link: <code>{joinUrl(v.qrToken)}</code>
              </p>
              <button className="btn btn-primary btn-block" onClick={() => openConsole(v)}>
                Open console
              </button>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
