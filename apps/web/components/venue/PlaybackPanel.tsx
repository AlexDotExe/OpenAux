'use client';

/**
 * Venue console Playback panel.
 *
 * Apple Music venues: this browser IS the playback device. We load MusicKit JS,
 * authorize with a developer token (see lib/playback/musicKit.ts seam), execute
 * incoming playback_command events, and POST /api/venues/:venueId/playback/state
 * on command completion and track end. If MusicKit can't be loaded/authorized
 * (no token, blocked CDN, unsupported browser) we render a clean
 * "MusicKit unavailable" state — the rest of the console keeps working.
 *
 * Spotify venues: the server drives Spotify Connect directly, so this panel is a
 * read-only status + now-playing readout fed by the realtime channel. Device
 * picking (GET/PUT .../playback/devices|device) is another workstream's scope.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  MusicProviderId,
  NowPlayingChangedEvent,
  PlaybackCommandEvent,
} from '@openaux/shared';

import { getApiClient, type AuthContext } from '../../lib/api';
import { useConsoleCommands } from '../../lib/playback/useConsoleCommands';
import {
  buildStateReport,
  executePlaybackCommand,
  loadMusicKit,
  type MusicKitInstance,
} from '../../lib/playback/musicKit';

export interface PlaybackPanelProps {
  venueId: string;
  auth: AuthContext;
  musicProvider: MusicProviderId;
  nowPlaying: NowPlayingChangedEvent['payload'] | null;
  connected: boolean;
}

type AppleState = 'loading' | 'ready' | 'unavailable';

export function PlaybackPanel({
  venueId,
  auth,
  musicProvider,
  nowPlaying,
  connected,
}: PlaybackPanelProps) {
  if (musicProvider === 'apple_music') {
    return <ApplePlaybackPanel venueId={venueId} auth={auth} connected={connected} />;
  }
  return <SpotifyPlaybackPanel nowPlaying={nowPlaying} connected={connected} />;
}

// ---------------------------------------------------------------------------
// Spotify: read-only status + now-playing readout from realtime events.
// ---------------------------------------------------------------------------

function SpotifyPlaybackPanel({
  nowPlaying,
  connected,
}: {
  nowPlaying: NowPlayingChangedEvent['payload'] | null;
  connected: boolean;
}) {
  const item = nowPlaying?.queueItem ?? null;
  return (
    <div className="card stack">
      <div className="top-bar">
        <strong>Playback — Spotify</strong>
        <span className={`badge-dot${connected ? ' is-live' : ''}`} />
      </div>
      {/* TODO(maintainer): call GET /api/venues/:venueId/spotify/status for real
          link state and GET .../playback/devices for device picking (other
          workstream owns those endpoints). */}
      <p className="helper-text">
        Server-driven Spotify Connect playback. The venue account controls the device; this console
        is read-only.
      </p>
      <div>
        <span className="helper-text">Now playing</span>
        <p>{item ? `${item.title} — ${item.artist}` : 'Nothing playing'}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Apple: MusicKit player that executes commands and reports state back.
// ---------------------------------------------------------------------------

function ApplePlaybackPanel({
  venueId,
  auth,
  connected,
}: {
  venueId: string;
  auth: AuthContext;
  connected: boolean;
}) {
  const [state, setState] = useState<AppleState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [lastCommand, setLastCommand] = useState<string | null>(null);
  const instanceRef = useRef<MusicKitInstance | null>(null);
  const endReportedRef = useRef(false);

  // Load + authorize MusicKit once.
  useEffect(() => {
    let cancelled = false;
    setState('loading');
    loadMusicKit()
      .then((instance) => {
        if (cancelled) return;
        if (!instance) {
          setState('unavailable');
          return;
        }
        instanceRef.current = instance;
        setState('ready');
      })
      .catch(() => {
        if (!cancelled) setState('unavailable');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const report = useCallback(
    async (opts: { commandId?: string; trackEnded?: boolean }) => {
      const instance = instanceRef.current;
      if (!instance) return;
      try {
        await getApiClient().reportPlaybackState(venueId, buildStateReport(instance, opts), auth);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not report playback state.');
      }
    },
    [venueId, auth],
  );

  // Execute incoming playback_command events, then report the resulting state.
  const onCommand = useCallback(
    (payload: PlaybackCommandEvent['payload']) => {
      const instance = instanceRef.current;
      if (!instance) return;
      setLastCommand(payload.command);
      endReportedRef.current = false;
      void executePlaybackCommand(instance, payload)
        .then(() => report({ commandId: payload.commandId }))
        .catch((e) => setError(e instanceof Error ? e.message : 'Playback command failed.'));
    },
    [report],
  );

  useConsoleCommands(venueId, auth.venueAdminToken ?? null, state === 'ready', onCommand);

  // Best-effort end-of-track detection. MusicKit fires playbackStateDidChange on
  // completion; when it lands idle (not playing, no current item) we report
  // trackEnded so the server advances the queue. TODO(maintainer): compare against
  // window.MusicKit.PlaybackStates.completed for a precise signal.
  useEffect(() => {
    const instance = instanceRef.current;
    if (state !== 'ready' || !instance?.addEventListener) return;
    const handler = () => {
      if (!instance.isPlaying && instance.nowPlayingItem === null && !endReportedRef.current) {
        endReportedRef.current = true;
        void report({ trackEnded: true });
      }
    };
    instance.addEventListener('playbackStateDidChange', handler);
    return () => instance.removeEventListener?.('playbackStateDidChange', handler);
  }, [state, report]);

  return (
    <div className="card stack">
      <div className="top-bar">
        <strong>Playback — Apple Music</strong>
        <span className={`badge-dot${connected && state === 'ready' ? ' is-live' : ''}`} />
      </div>

      {state === 'loading' && <p className="helper-text">Loading MusicKit…</p>}

      {state === 'unavailable' && (
        <p className="helper-text">
          MusicKit unavailable. Set NEXT_PUBLIC_APPLE_DEVELOPER_TOKEN (or the token endpoint) and
          open this console in a MusicKit-capable browser to play audio here.
        </p>
      )}

      {state === 'ready' && (
        <>
          <p className="helper-text">
            This device is the venue player. Incoming song changes play here automatically.
          </p>
          <p className="helper-text">Last command: {lastCommand ?? 'none yet'}</p>
        </>
      )}

      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
