'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import { StreamingConnect } from '@/components/StreamingConnect';
import { NowPlaying } from '@/components/NowPlaying';
import { SpotifyDeviceSelector } from '@/components/SpotifyDeviceSelector';
import { calculateSmartSettings } from '@/lib/services/smartMonetization';

interface VenueData {
  venue: { id: string; name: string };
  activeSession: {
    id: string;
    currentEnergyLevel: number;
    isActive: boolean;
  } | null;
  streamingService: string | null;
  isStreamingConnected: boolean;
  connectedAccountName?: string | null;
  connectedAccountEmail?: string | null;
}

interface QueueItem {
  requestId: string;
  songId: string;
  title: string;
  artist: string;
  score: number;
  voteCount: number;
  spotifyId?: string;
  youtubeId?: string;
  userId?: string;
}

export default function AdminPage() {
  const params = useParams<{ venueId: string }>();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState('');
  const [authed, setAuthed] = useState(false);
  const [venueData, setVenueData] = useState<VenueData | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [userCount, setUserCount] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [origin, setOrigin] = useState('');
  const [currentYoutubeId, setCurrentYoutubeId] = useState<string | null>(null);
  // Venue settings state
  const [defaultBoostPrice, setDefaultBoostPrice] = useState(5.0);
  const [maxSongRepeatsPerHour, setMaxSongRepeatsPerHour] = useState(3);
  const [maxSongsPerUser, setMaxSongsPerUser] = useState(5);
  const [monetizationEnabled, setMonetizationEnabled] = useState(false);
  const [smartMonetizationEnabled, setSmartMonetizationEnabled] = useState(false);
  const [settingsSaveStatus, setSettingsSaveStatus] = useState<string | null>(null);
  const [simulatedUsers, setSimulatedUsers] = useState(0);

  const updateSimulatedUsers = async (count: number) => {
    if (!venueData?.activeSession) return;
    try {
      await fetch(`/api/sessions/${venueData.activeSession.id}/simulated-users`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count }),
      });
    } catch (err) {
      console.error('Failed to update simulated users:', err);
    }
  };

  const handleSimulatedUsersChange = (newCount: number) => {
    setSimulatedUsers(newCount);
    updateSimulatedUsers(newCount);
  };

  useEffect(() => {
    setOrigin(window.location.origin);
    // Auto-authenticate if the password was stored by the sign-in page
    const stored = sessionStorage.getItem(`adminPassword_${params.venueId}`);
    if (stored) {
      setPassword(stored);
      setAuthed(true);
    }

    // Show connection status from OAuth callback
    const connected = searchParams.get('connected');
    if (connected) {
      setStatus(`Connected to ${connected === 'spotify' ? 'Spotify' : 'YouTube'}!`);
    }
    const error = searchParams.get('error');
    if (error) {
      setStatus(`Connection failed: ${error}`);
    }
  }, [params.venueId, searchParams]);

  const loadSettings = useCallback(async () => {
    if (!params.venueId) return;
    try {
      const res = await fetch(`/api/venues/${params.venueId}/settings`);
      if (res.ok) {
        const settings = await res.json();
        setDefaultBoostPrice(settings.defaultBoostPrice ?? 5.0);
        setMaxSongRepeatsPerHour(settings.maxSongRepeatsPerHour ?? 3);
        setMaxSongsPerUser(settings.maxSongsPerUser ?? 5);
        setMonetizationEnabled(settings.monetizationEnabled ?? false);
        setSmartMonetizationEnabled(settings.smartMonetizationEnabled ?? false);
      }
    } catch (err) {
      console.error('Failed to load venue settings:', err);
    }
  }, [params.venueId]);

  const load = useCallback(async () => {
    if (!params.venueId) return;
    const res = await fetch(`/api/venues/${params.venueId}`);
    const data: VenueData = await res.json();
    setVenueData(data);
    if (data.activeSession) {
      const sessRes = await fetch(`/api/sessions/${data.activeSession.id}`);
      const sessData = await sessRes.json();
      setQueue(sessData.queue ?? []);

      // Count unique users in the session
      const uniqueUsers = new Set(sessData.queue?.map((item: QueueItem) => item.userId).filter(Boolean));
      setUserCount(uniqueUsers.size);
    }
    // Note: Settings are NOT reloaded here to prevent overwriting unsaved changes
  }, [params.venueId]);

  useEffect(() => {
    if (authed) {
      load();
      loadSettings(); // Load settings only once on initial auth
    }
  }, [authed, load, loadSettings]);

  useEffect(() => {
    if (!authed) return;
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [authed, load]);

  const handleAuth = (e: React.FormEvent) => {
    e.preventDefault();
    // Simple client-side auth check for POC
    // Real admin action calls validate server-side
    setAuthed(true);
    setLoading(true);
    load().finally(() => setLoading(false));
  };

  const sessionAction = async (action: 'start' | 'end') => {
    setLoading(true);
    setStatus(null);
    const res = await fetch(`/api/admin/${params.venueId}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminPassword: password, action }),
    });
    const data = await res.json();
    setStatus(res.ok ? `Session ${action}ed` : `${data.error}`);
    await load();
    setLoading(false);
  };

  const handleAdvance = async (requestId?: string, wasSkipped = false) => {
    if (!venueData?.activeSession) return;
    setLoading(true);
    const res = await fetch(`/api/sessions/${venueData.activeSession.id}/advance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentRequestId: requestId, wasSkipped }),
    });
    const data = await res.json();
    // If YouTube, update the video ID for client-side playback
    if (data.service === 'youtube' && data.trackId) {
      setCurrentYoutubeId(data.trackId);
    }
    await load();
    setLoading(false);
  };

  const handleSkip = (requestId: string) => handleAdvance(requestId, true);

  const handleTrackEnded = () => {
    // Auto-advance when track finishes
    console.log('[AdminPage] handleTrackEnded called');
    const currentPlaying = queue[0];
    if (currentPlaying) {
      console.log('[AdminPage] Advancing from:', currentPlaying.title);
      handleAdvance(currentPlaying.requestId, false);
    } else {
      console.log('[AdminPage] No current song, advancing to first in queue');
      handleAdvance(undefined, false);
    }
  };

  const handleBlacklist = async (songId: string) => {
    setLoading(true);
    await fetch(`/api/admin/${params.venueId}/blacklist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminPassword: password, songId }),
    });
    await load();
    setLoading(false);
  };

  const handleDelete = async (requestId: string) => {
    if (!confirm('Delete this song request?')) return;
    setLoading(true);
    await fetch(`/api/admin/${params.venueId}/requests/${requestId}/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminPassword: password }),
    });
    await load();
    setLoading(false);
  };

  const handlePlayNow = async (requestId: string) => {
    if (!confirm('Play this song immediately? This will skip the current track.')) return;
    setLoading(true);

    const currentRequestId = queue[0]?.requestId; // First item is currently playing

    const res = await fetch(`/api/admin/${params.venueId}/requests/${requestId}/play-now`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminPassword: password, currentRequestId }),
    });

    const data = await res.json();
    if (res.ok && data.service === 'youtube') {
      setCurrentYoutubeId(data.nowPlaying.trackId); // Update YouTube player
    }

    await load();
    setLoading(false);
  };

  const handleSaveSettings = async () => {
    setLoading(true);
    setSettingsSaveStatus(null);
    try {
      const res = await fetch(`/api/venues/${params.venueId}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminPassword: password,
          defaultBoostPrice,
          maxSongRepeatsPerHour,
          maxSongsPerUser,
          monetizationEnabled,
          smartMonetizationEnabled,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setSettingsSaveStatus('Settings saved successfully!');
        // Reload settings from server to confirm save
        await loadSettings();
        setTimeout(() => setSettingsSaveStatus(null), 3000);
      } else {
        setSettingsSaveStatus(`Error: ${data.error}`);
      }
    } catch (err) {
      setSettingsSaveStatus('Failed to save settings');
    }
    setLoading(false);
  };

  if (!authed) {
    return (
      <main className="min-h-screen bg-gray-950 text-white flex items-center justify-center p-6">
        <div className="max-w-sm w-full space-y-4">
          <h1 className="text-2xl font-bold text-center">Admin</h1>
          <form onSubmit={handleAuth} className="space-y-3">
            <input
              type="password"
              placeholder="Admin password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-green-500"
            />
            <button
              type="submit"
              className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-2 rounded-lg"
            >
              Login
            </button>
          </form>
        </div>
      </main>
    );
  }

  if (loading && !venueData) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        <p className="animate-pulse text-gray-400">Loading...</p>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white p-4">
      <div className="max-w-lg mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">{venueData?.venue.name} — Admin</h1>
        </div>

        {status && (
          <div className="bg-gray-800 rounded-xl p-3 text-sm">{status}</div>
        )}

        {/* Streaming Connection Card */}
        <StreamingConnect
          venueId={params.venueId}
          streamingService={venueData?.streamingService ?? null}
          isConnected={venueData?.isStreamingConnected ?? false}
          connectedAccountName={venueData?.connectedAccountName}
          connectedAccountEmail={venueData?.connectedAccountEmail}
          onDisconnect={load}
        />

        {/* Session Controls */}
        <div className="bg-gray-900 rounded-xl p-4 space-y-3">
          <h2 className="font-semibold">Session</h2>
          <div className="flex gap-3">
            <button
              onClick={() => sessionAction('start')}
              disabled={loading || !!venueData?.activeSession}
              className="flex-1 bg-green-700 hover:bg-green-600 disabled:opacity-40 text-white py-2 rounded-lg font-semibold"
            >
              Start Session
            </button>
            <button
              onClick={() => sessionAction('end')}
              disabled={loading || !venueData?.activeSession}
              className="flex-1 bg-red-800 hover:bg-red-700 disabled:opacity-40 text-white py-2 rounded-lg font-semibold"
            >
              End Session
            </button>
          </div>
        </div>

        {/* Venue Settings */}
        <div className="bg-gray-900 rounded-xl p-4 space-y-4">
          <h2 className="font-semibold">Venue Settings</h2>

          {settingsSaveStatus && (
            <div className="bg-gray-800 rounded-lg p-3 text-sm">
              {settingsSaveStatus}
            </div>
          )}

          <div className="space-y-3">
            {/* Smart Monetization Toggle */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Smart Monetization</label>
                <button
                  onClick={() => setSmartMonetizationEnabled(!smartMonetizationEnabled)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    smartMonetizationEnabled ? 'bg-green-600' : 'bg-gray-700'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      smartMonetizationEnabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
              <p className="text-xs text-gray-400">
                Auto-adjust pricing and limits based on crowd size:
                <br />• Less than 5 users: Free
                <br />• 5-10 users: $.50/boost
                <br />• 10-15 users: $1/boost
                <br />• 15+ users: $2/boost

              </p>
            </div>

            {/* Manual Controls - Only show when Smart Monetization is OFF */}
            {!smartMonetizationEnabled && (
              <>
                <div className="border-t border-gray-700 pt-3">
                  <p className="text-xs text-gray-500 mb-3">Manual Controls</p>
                </div>

                {/* Monetization Toggle */}
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Enable Monetization (Boost Feature)</label>
                  <button
                    onClick={() => setMonetizationEnabled(!monetizationEnabled)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      monetizationEnabled ? 'bg-green-600' : 'bg-gray-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        monetizationEnabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {/* Boost Price */}
                <div className="space-y-1">
                  <label className="text-sm font-medium">Boost Price ($)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={defaultBoostPrice}
                    onChange={(e) => setDefaultBoostPrice(parseFloat(e.target.value))}
                    className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>

                {/* Max Song Repeats Per Hour */}
                <div className="space-y-1">
                  <label className="text-sm font-medium">Max Song Repeats Per Hour</label>
                  <input
                    type="number"
                    min="0"
                    value={maxSongRepeatsPerHour}
                    onChange={(e) => setMaxSongRepeatsPerHour(parseInt(e.target.value))}
                    className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>

                {/* Max Songs Per User */}
                <div className="space-y-1">
                  <label className="text-sm font-medium">Max Pending Songs Per User</label>
                  <input
                    type="number"
                    min="0"
                    value={maxSongsPerUser}
                    onChange={(e) => setMaxSongsPerUser(parseInt(e.target.value))}
                    className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
              </>
            )}

            {/* Save Button */}
            <button
              onClick={handleSaveSettings}
              disabled={loading}
              className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white font-semibold py-2 rounded-lg transition-colors"
            >
              Save Settings
            </button>
          </div>
        </div>

        {/* Now Playing Panel */}
        {venueData?.activeSession && venueData.isStreamingConnected && (
          <NowPlaying
            venueId={params.venueId}
            streamingService={venueData.streamingService}
            onTrackEnded={handleTrackEnded}
            youtubeVideoId={currentYoutubeId}
          />
        )}

        {/* Spotify Device Selector */}
        {venueData?.activeSession && (
          <SpotifyDeviceSelector
            venueId={params.venueId}
            streamingService={venueData.streamingService}
          />
        )}

        {/* QR Code Share */}
        {venueData?.activeSession && (
          <div className="bg-gray-900 rounded-xl p-4 space-y-3">
            <h2 className="font-semibold">Share with Guests</h2>
            <p className="text-gray-400 text-sm">Guests can scan this QR code to join the session.</p>
            <div className="flex justify-center bg-white rounded-xl p-4">
              <QRCodeSVG
                value={`${origin}/venues/${params.venueId}`}
                size={200}
                bgColor="#ffffff"
                fgColor="#000000"
                level="M"
              />
            </div>
            <p className="text-center text-xs text-gray-500 break-all">
              {origin}/venues/{params.venueId}
            </p>
          </div>
        )}

        {/* Active Users Count */}
        {venueData?.activeSession && (
          <div className="bg-gray-900 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Active Users</h2>
              <span className="text-green-400 font-mono text-2xl">{userCount + simulatedUsers}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-400">Real: {userCount} | Simulated: {simulatedUsers}</span>
            </div>

            {/* Simulate Users Controls */}
            <div className="flex gap-2">
              <button
                onClick={() => handleSimulatedUsersChange(Math.max(0, simulatedUsers - 1))}
                disabled={simulatedUsers === 0}
                className="flex-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                - 1 User
              </button>
              <button
                onClick={() => handleSimulatedUsersChange(simulatedUsers + 5)}
                className="flex-1 bg-gray-800 hover:bg-gray-700 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                + 5 Users
              </button>
              <button
                onClick={() => handleSimulatedUsersChange(0)}
                disabled={simulatedUsers === 0}
                className="flex-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                Reset
              </button>
            </div>

            {/* Show Smart Monetization Preview */}
            {smartMonetizationEnabled && (() => {
              const totalUsers = userCount + simulatedUsers;
              const settings = calculateSmartSettings(totalUsers);
              return (
                <div className="bg-gray-800 rounded-lg p-3 space-y-1">
                  <p className="text-xs text-gray-400 font-semibold">Smart Settings ({totalUsers} users):</p>
                  <div className="text-sm space-y-0.5">
                    <p className="text-gray-300">
                      💰 Boost: {settings.boostPrice === 0 ? 'FREE' : `$${settings.boostPrice.toFixed(2)}`}
                    </p>
                    <p className="text-gray-300">🎵 Max songs/user: {settings.maxSongsPerUser}</p>
                    <p className="text-gray-300">🔁 Max repeats/hour: {settings.maxSongRepeatsPerHour}</p>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* Live Queue */}
        {queue.length > 0 && (
          <div className="bg-gray-900 rounded-xl p-4 space-y-3">
            <h2 className="font-semibold">Live Queue</h2>
            {queue.map((item, idx) => (
              <div key={item.requestId} className="flex items-center gap-2">
                <span className="text-gray-600 text-sm w-5">{idx + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate text-sm">{item.title}</p>
                  <p className="text-gray-400 text-xs truncate">{item.artist}</p>
                </div>
                <span className="text-xs text-gray-500">{item.score.toFixed(1)}</span>
                <button
                  onClick={() => handlePlayNow(item.requestId)}
                  disabled={loading}
                  className="text-xs bg-green-700 hover:bg-green-600 disabled:opacity-40 px-2 py-1 rounded transition-colors"
                  title="Play this song now"
                >
                  Play Now
                </button>
                <button
                  onClick={() => handleDelete(item.requestId)}
                  disabled={loading}
                  className="text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-40 px-2 py-1 rounded transition-colors"
                >
                  Delete
                </button>
                <button
                  onClick={() => handleSkip(item.requestId)}
                  disabled={loading}
                  className="text-xs bg-gray-800 hover:bg-red-900 disabled:opacity-40 px-2 py-1 rounded transition-colors"
                >
                  Skip
                </button>
                <button
                  onClick={() => handleBlacklist(item.songId)}
                  disabled={loading}
                  className="text-xs bg-gray-800 hover:bg-red-900 disabled:opacity-40 px-2 py-1 rounded transition-colors"
                >
                  Ban
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
