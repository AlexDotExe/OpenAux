'use client';

/**
 * Venue console: session/QR display, control-mode toggle, block management,
 * suggestion-approval list, skip, override (play now/next), fallback
 * playlist editor, anthem setup.
 */

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { QueueSnapshot } from '@openaux/shared';

import { getApiClient, type AuthContext, type VenueSummary } from '../../../lib/api';
import { resolveConsoleMusicProvider } from '../../../lib/config';
import { clearVenueAdminToken, loadVenueAdminToken } from '../../../lib/session';
import { useVenueChannel } from '../../../lib/useVenueChannel';
import { AnthemSetupForm } from '../../../components/venue/AnthemSetupForm';
import { PlaybackPanel } from '../../../components/venue/PlaybackPanel';
import { BlockManagementForm } from '../../../components/venue/BlockManagementForm';
import { ControlModeToggle } from '../../../components/venue/ControlModeToggle';
import { FallbackPlaylistEditor } from '../../../components/venue/FallbackPlaylistEditor';
import { OverrideForm } from '../../../components/venue/OverrideForm';
import { QrPanel } from '../../../components/venue/QrPanel';
import { SkipButton } from '../../../components/venue/SkipButton';
import { SuggestionApprovalList } from '../../../components/venue/SuggestionApprovalList';

export default function VenueConsolePage() {
  const params = useParams<{ venueId: string }>();
  const venueId = params.venueId;
  const router = useRouter();

  const [adminToken, setAdminToken] = useState<string | null | undefined>(undefined);
  const [venue, setVenue] = useState<VenueSummary | null>(null);
  const [snapshot, setSnapshot] = useState<QueueSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const channel = useVenueChannel(venueId ?? null);

  useEffect(() => {
    if (!venueId) return;
    setAdminToken(loadVenueAdminToken(venueId) ?? null);
  }, [venueId]);

  useEffect(() => {
    if (!venueId || !adminToken) return;
    getApiClient()
      .getVenue(venueId)
      .then(setVenue)
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'Could not load venue.'));
    getApiClient()
      .getQueue(venueId)
      .then(setSnapshot)
      .catch(() => undefined);
  }, [venueId, adminToken]);

  useEffect(() => {
    if (channel.queue) setSnapshot(channel.queue);
  }, [channel.queue]);

  const auth: AuthContext = useMemo(
    () => ({ venueAdminToken: adminToken ?? undefined }),
    [adminToken],
  );

  if (adminToken === undefined) {
    return <main className="page">Loading…</main>;
  }

  if (!adminToken) {
    return (
      <main className="page stack">
        <h1>Not signed in</h1>
        <p className="helper-text">Enter a venue id and admin token to open the console.</p>
        <button className="btn btn-primary" onClick={() => router.push('/venue')}>
          Go to venue login
        </button>
      </main>
    );
  }

  const pendingApprovals = [...(snapshot?.upNext ?? []), ...(snapshot?.rest ?? [])].filter(
    (i) => i.playabilityState === 'awaiting_approval',
  );

  const nowPlayingItem = channel.nowPlaying?.queueItem ?? snapshot?.nowPlaying ?? null;

  return (
    <main className="page page--wide stack">
      <div className="top-bar">
        <div>
          <h1>Venue console</h1>
          <p className="helper-text">
            <span className={`badge-dot${channel.connectionState === 'open' ? ' is-live' : ''}`} />{' '}
            {venueId}
          </p>
        </div>
        <button
          className="btn btn-sm"
          onClick={() => {
            clearVenueAdminToken(venueId);
            router.push('/venue');
          }}
        >
          Sign out
        </button>
      </div>

      {loadError && <p className="error-text">{loadError}</p>}

      {venue && (
        <>
          <QrPanel
            venueName={venue.name}
            controlMode={venue.controlMode}
            joinUrl={
              typeof window !== 'undefined'
                ? `${window.location.origin}/patron/join?token=${venue.qrToken}`
                : `/patron/join?token=${venue.qrToken}`
            }
          />

          <ControlModeToggle
            venueId={venueId}
            controlMode={venue.controlMode}
            auth={auth}
            onChanged={(controlMode) => setVenue((v) => (v ? { ...v, controlMode } : v))}
          />

          <SkipButton
            venueId={venueId}
            auth={auth}
            nowPlayingTitle={nowPlayingItem?.title ?? null}
          />

          <PlaybackPanel
            venueId={venueId}
            auth={auth}
            musicProvider={resolveConsoleMusicProvider()}
            nowPlaying={channel.nowPlaying}
            connected={channel.connectionState === 'open'}
          />

          {venue.controlMode === 'suggestion' && (
            <SuggestionApprovalList venueId={venueId} auth={auth} items={pendingApprovals} />
          )}

          <OverrideForm venueId={venueId} auth={auth} />

          <BlockManagementForm
            venueId={venueId}
            auth={auth}
            blockExplicit={venue.blockExplicit}
            blockedGenres={venue.blockedGenres}
            blockedArtists={venue.blockedArtists}
            onChanged={(next) => setVenue((v) => (v ? { ...v, ...next } : v))}
          />

          {/* Contract gap: no GET endpoint returns the current fallback playlist
              (SetFallbackPlaylistRequest is write-only), so this always starts empty —
              venues re-add fallback songs each console load until that's fixed. */}
          <FallbackPlaylistEditor venueId={venueId} auth={auth} initialTracks={[]} />

          <AnthemSetupForm venueId={venueId} auth={auth} />
        </>
      )}
    </main>
  );
}
