'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { AdminControlPanel } from '@/components/AdminControlPanel';
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

export interface PendingSuggestion {
  requestId: string;
  title: string;
  artist: string;
  albumArtUrl?: string | null;
  userId: string;
  displayName?: string | null;
  createdAt: string;
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
  const [suggestionModeEnabled, setSuggestionModeEnabled] = useState(false);
  const [settingsSaveStatus, setSettingsSaveStatus] = useState<string | null>(null);
  const [simulatedUsers, setSimulatedUsers] = useState(0);
  // Pending suggestions state
  const [pendingSuggestions, setPendingSuggestions] = useState<PendingSuggestion[]>([]);

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
        setSuggestionModeEnabled(settings.suggestionModeEnabled ?? false);
      }
    } catch (err) {
      console.error('Failed to load venue settings:', err);
    }
  }, [params.venueId]);

  const loadPendingSuggestions = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`/api/admin/${params.venueId}/suggestions?sessionId=${sessionId}`);
      if (res.ok) {
        const data = await res.json();
        setPendingSuggestions(data.suggestions ?? []);
      }
    } catch (err) {
      console.error('Failed to load pending suggestions:', err);
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

      // Load pending suggestions if suggestion mode is enabled
      if (suggestionModeEnabled) {
        await loadPendingSuggestions(data.activeSession.id);
      }
    }
    // Note: Settings are NOT reloaded here to prevent overwriting unsaved changes
  }, [params.venueId, suggestionModeEnabled, loadPendingSuggestions]);

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

  const handleTrackEnded = async () => {
    // Auto-advance when track finishes
    console.log('[AdminPage] handleTrackEnded called');

    // Fetch fresh queue data to avoid stale state
    if (!venueData?.activeSession) {
      console.warn('[AdminPage] No active session, cannot advance');
      return;
    }

    try {
      const sessRes = await fetch(`/api/sessions/${venueData.activeSession.id}`);
      const sessData = await sessRes.json();
      const freshQueue = sessData.queue ?? [];

      const currentPlaying = freshQueue[0];
      if (currentPlaying) {
        console.log('[AdminPage] Advancing from (fresh):', currentPlaying.title, 'requestId:', currentPlaying.requestId);
        await handleAdvance(currentPlaying.requestId, false);
      } else {
        console.log('[AdminPage] No current song in queue, advancing to trigger next selection');
        await handleAdvance(undefined, false);
      }
    } catch (error) {
      console.error('[AdminPage] Error in handleTrackEnded:', error);
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

  const handleApproveSuggestion = async (requestId: string) => {
    setLoading(true);
    await fetch(`/api/admin/${params.venueId}/requests/${requestId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminPassword: password }),
    });
    await load();
    setLoading(false);
  };

  const handleRejectSuggestion = async (requestId: string) => {
    setLoading(true);
    await fetch(`/api/admin/${params.venueId}/requests/${requestId}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminPassword: password }),
    });
    await load();
    setLoading(false);
  };

  const handleBulkAction = async (action: 'approve' | 'reject', requestIds: string[]) => {
    if (requestIds.length === 0) return;
    setLoading(true);
    const sessionId = venueData?.activeSession?.id;
    await fetch(`/api/admin/${params.venueId}/suggestions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminPassword: password, action, requestIds, sessionId }),
    });
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
          suggestionModeEnabled,
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

        {/* Unified Control Panel */}
        <AdminControlPanel
          venueId={params.venueId}
          password={password}
          origin={origin}
          streamingService={venueData?.streamingService ?? null}
          isConnected={venueData?.isStreamingConnected ?? false}
          connectedAccountName={venueData?.connectedAccountName}
          connectedAccountEmail={venueData?.connectedAccountEmail}
          activeSession={!!venueData?.activeSession}
          loading={loading}
          onDisconnect={load}
          onSessionStart={() => sessionAction('start')}
          onSessionEnd={() => sessionAction('end')}
          // Venue Settings
          defaultBoostPrice={defaultBoostPrice}
          setDefaultBoostPrice={setDefaultBoostPrice}
          maxSongRepeatsPerHour={maxSongRepeatsPerHour}
          setMaxSongRepeatsPerHour={setMaxSongRepeatsPerHour}
          maxSongsPerUser={maxSongsPerUser}
          setMaxSongsPerUser={setMaxSongsPerUser}
          monetizationEnabled={monetizationEnabled}
          setMonetizationEnabled={setMonetizationEnabled}
          smartMonetizationEnabled={smartMonetizationEnabled}
          setSmartMonetizationEnabled={setSmartMonetizationEnabled}
          suggestionModeEnabled={suggestionModeEnabled}
          setSuggestionModeEnabled={setSuggestionModeEnabled}
          onSaveSettings={handleSaveSettings}
          settingsSaveStatus={settingsSaveStatus}
          // Active Users
          userCount={userCount}
          simulatedUsers={simulatedUsers}
          onSimulatedUsersChange={handleSimulatedUsersChange}
          smartSettings={smartMonetizationEnabled ? calculateSmartSettings(userCount + simulatedUsers) : null}
          // Now Playing & Queue
          youtubeVideoId={currentYoutubeId}
          onTrackEnded={handleTrackEnded}
          queue={queue}
          onPlayNow={handlePlayNow}
          onDelete={handleDelete}
          onSkip={handleSkip}
          onBlacklist={handleBlacklist}
          // Pending Suggestions
          pendingSuggestions={pendingSuggestions}
          onApproveSuggestion={handleApproveSuggestion}
          onRejectSuggestion={handleRejectSuggestion}
          onBulkAction={handleBulkAction}
        />
      </div>
    </main>
  );
}
