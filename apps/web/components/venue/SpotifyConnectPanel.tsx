'use client';

/**
 * Spotify account linking + Connect device picker for the venue console.
 *
 * Drives the venue-admin OAuth + playback endpoints (see CONTRACTS.md):
 *   GET  /api/venues/:venueId/spotify/status    → linked?
 *   POST /api/venues/:venueId/spotify/connect   → authorizeUrl (opened in a tab)
 *   GET  /api/venues/:venueId/playback/devices  → Connect devices
 *   PUT  /api/venues/:venueId/playback/device   → pick the device the DJ brain targets
 *
 * The OAuth flow can't be completed in-page (Spotify redirects the operator away
 * and calls back the public /api/spotify/callback), so after "Connect Spotify"
 * opens the authorize tab we surface a "Refresh status" action; once linked, the
 * device picker appears.
 */

import { useCallback, useEffect, useState } from 'react';
import type { PlaybackDevice, SpotifyLinkStatusResponse } from '@openaux/shared';

import { getApiClient, type AuthContext } from '../../lib/api';

interface SpotifyConnectPanelProps {
  venueId: string;
  auth: AuthContext;
}

function errMessage(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

export function SpotifyConnectPanel({ venueId, auth }: SpotifyConnectPanelProps) {
  const [status, setStatus] = useState<SpotifyLinkStatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [awaitingAuth, setAwaitingAuth] = useState(false);

  const [devices, setDevices] = useState<PlaybackDevice[] | null>(null);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [savingDevice, setSavingDevice] = useState(false);

  const refreshStatus = useCallback(async () => {
    setStatusLoading(true);
    setError(null);
    try {
      setStatus(await getApiClient().spotifyStatus(venueId, auth));
    } catch (e) {
      setError(errMessage(e, 'Could not load Spotify link status.'));
    } finally {
      setStatusLoading(false);
    }
  }, [venueId, auth]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const { authorizeUrl } = await getApiClient().spotifyConnect(venueId, auth);
      // Open Spotify's consent screen in a new tab so the console keeps its state.
      window.open(authorizeUrl, '_blank', 'noopener,noreferrer');
      setAwaitingAuth(true);
    } catch (e) {
      setError(errMessage(e, 'Could not start Spotify authorization.'));
    } finally {
      setConnecting(false);
    }
  }, [venueId, auth]);

  const loadDevices = useCallback(async () => {
    setDevicesLoading(true);
    setError(null);
    try {
      const res = await getApiClient().listPlaybackDevices(venueId, auth);
      setDevices(res.devices);
      const active = res.devices.find((d) => d.isActive);
      if (active) setSelectedDeviceId(active.providerDeviceId);
    } catch (e) {
      setError(errMessage(e, 'Could not load Spotify devices.'));
    } finally {
      setDevicesLoading(false);
    }
  }, [venueId, auth]);

  const chooseDevice = useCallback(
    async (providerDeviceId: string) => {
      setSavingDevice(true);
      setError(null);
      try {
        const res = await getApiClient().setPlaybackDevice(venueId, { providerDeviceId }, auth);
        setSelectedDeviceId(res.playbackDeviceId);
      } catch (e) {
        setError(errMessage(e, 'Could not set the playback device.'));
      } finally {
        setSavingDevice(false);
      }
    },
    [venueId, auth],
  );

  const linked = status?.linked ?? false;

  return (
    <div className="card stack">
      <div className="top-bar">
        <strong>Spotify Connect</strong>
        <span className={`badge-dot${linked ? ' is-live' : ''}`} />
      </div>

      {statusLoading && <p className="helper-text">Checking Spotify link…</p>}

      {!statusLoading && !linked && (
        <>
          <p className="helper-text">
            Link the venue&apos;s Spotify account (Premium required) so the server can drive
            playback on a Connect device.
          </p>
          <button className="btn btn-primary" onClick={handleConnect} disabled={connecting}>
            {connecting ? 'Starting…' : 'Connect Spotify'}
          </button>
          {awaitingAuth && (
            <p className="helper-text">
              A Spotify authorization tab was opened. After you approve access there, come back and
              refresh.
            </p>
          )}
          <button className="btn btn-sm" onClick={() => void refreshStatus()}>
            Refresh status
          </button>
        </>
      )}

      {!statusLoading && linked && (
        <>
          <p className="helper-text">
            Linked ✓{status?.expiresAt ? ` — token valid until ${formatWhen(status.expiresAt)}` : ''}
          </p>

          {!devices && (
            <button className="btn btn-primary" onClick={() => void loadDevices()} disabled={devicesLoading}>
              {devicesLoading ? 'Loading devices…' : 'Choose playback device'}
            </button>
          )}

          {devices && devices.length === 0 && (
            <p className="helper-text">
              No active Spotify Connect devices found. Open Spotify on the venue&apos;s speaker/phone,
              start any track, then reload devices.
            </p>
          )}

          {devices && devices.length > 0 && (
            <div className="stack">
              <span className="helper-text">Playback device</span>
              {devices.map((d) => {
                const isSelected = d.providerDeviceId === selectedDeviceId;
                return (
                  <button
                    key={d.providerDeviceId}
                    className={`btn${isSelected ? ' btn-primary' : ''}`}
                    onClick={() => void chooseDevice(d.providerDeviceId)}
                    disabled={savingDevice || isSelected}
                  >
                    {d.name}
                    {isSelected ? ' — selected' : d.isActive ? ' (active)' : ''}
                  </button>
                );
              })}
            </div>
          )}

          {devices && (
            <button className="btn btn-sm" onClick={() => void loadDevices()} disabled={devicesLoading}>
              {devicesLoading ? 'Reloading…' : 'Reload devices'}
            </button>
          )}
        </>
      )}

      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString();
}
