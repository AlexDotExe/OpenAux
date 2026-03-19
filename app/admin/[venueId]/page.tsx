'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
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
  isPreloaded?: boolean;
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
  const [adminToken, setAdminToken] = useState('');
  const [authed, setAuthed] = useState(false);
  const [venueData, setVenueData] = useState<VenueData | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [userCount, setUserCount] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [origin] = useState(() => (typeof window === 'undefined' ? '' : window.location.origin));
  const [currentYoutubeId, setCurrentYoutubeId] = useState<string | null>(null);
  const [currentSpotifyId, setCurrentSpotifyId] = useState<string | null>(null);
  // Venue settings state
  const [defaultBoostPrice, setDefaultBoostPrice] = useState(5.0);
  const [maxSongRepeatsPerHour, setMaxSongRepeatsPerHour] = useState(3);
  const [maxSongsPerUser, setMaxSongsPerUser] = useState(5);
  const [monetizationEnabled, setMonetizationEnabled] = useState(false);
  const [smartMonetizationEnabled, setSmartMonetizationEnabled] = useState(false);
  const [suggestionModeEnabled, setSuggestionModeEnabled] = useState(false);
  const [crowdControlEnabled, setCrowdControlEnabled] = useState(true);
  const [settingsSaveStatus, setSettingsSaveStatus] = useState<string | null>(null);
  const [simulatedUsers, setSimulatedUsers] = useState(0);
  // Playlist settings state
  const [activePlaylistId, setActivePlaylistId] = useState<string | null>(null);
  const [playlistPriority, setPlaylistPriority] = useState(false);
  // Pending suggestions state
  const [pendingSuggestions, setPendingSuggestions] = useState<PendingSuggestion[]>([]);
  const [payments, setPayments] = useState<Array<{
    id: string;
    amount: number;
    type: string;
    status: string;
    venueShareAmount: number | null;
    platformShareAmount: number | null;
    createdAt: string;
    completedAt: string | null;
  }>>([]);
  const [creditTransactions, setCreditTransactions] = useState<Array<{
    id: string;
    amount: number;
    type: string;
    description: string | null;
    createdAt: string;
    user: { displayName: string | null; email: string | null };
  }>>([]);

  const formatAdminError = useCallback((error: string) => {
    switch (error) {
      case 'invalid_state':
        return 'Your sign-in session expired. Please sign in again.';
      case 'spotify_denied':
        return 'Spotify sign-in was cancelled.';
      case 'google_denied':
        return 'Google sign-in was cancelled.';
      case 'spotify_token_failed':
      case 'google_token_failed':
        return 'OAuth authorization could not be completed.';
      case 'spotify_profile_failed':
      case 'google_profile_failed':
        return 'The connected account details could not be loaded.';
      case 'spotify_account_in_use':
        return 'That Spotify account is already linked to another venue.';
      case 'google_account_in_use':
        return 'That Google account is already linked to another venue.';
      case 'venue_not_found':
        return 'No venue is linked to that admin account yet.';
      default:
        return `Connection failed: ${error}`;
    }
  }, []);

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
    const getCookie = (name: string) =>
      document.cookie
        .split('; ')
        .find((entry) => entry.startsWith(`${name}=`))
        ?.split('=')
        .slice(1)
        .join('=');

    const pendingToken = getCookie('_pending_admin_auth_token');
    const pendingVenueId = getCookie('_pending_admin_auth_venue');
    const pendingProvider = getCookie('_pending_admin_auth_provider');
    const pendingConnectedProvider = getCookie('_pending_admin_connected_provider');

    const clearPendingCookie = (name: string) => {
      document.cookie = `${name}=; Max-Age=0; Path=/`;
    };

    if (pendingToken && pendingVenueId === params.venueId) {
      sessionStorage.setItem(`adminAuthToken_${params.venueId}`, pendingToken);
      setAdminToken(pendingToken);
      setAuthed(true);
      if (pendingConnectedProvider) {
        setStatus(`Connected to ${pendingConnectedProvider === 'spotify' ? 'Spotify' : 'Google'}!`);
      } else if (pendingProvider) {
        setStatus(`Signed in with ${pendingProvider === 'spotify' ? 'Spotify' : 'Google'}.`);
      }
    } else {
      const stored =
        sessionStorage.getItem(`adminAuthToken_${params.venueId}`) ??
        sessionStorage.getItem(`adminPassword_${params.venueId}`);
      if (stored) {
        setAdminToken(stored);
        setAuthed(true);
      }
    }

    clearPendingCookie('_pending_admin_auth_token');
    clearPendingCookie('_pending_admin_auth_venue');
    clearPendingCookie('_pending_admin_auth_provider');
    clearPendingCookie('_pending_admin_connected_provider');

    const connected = searchParams.get('connected');
    if (connected) {
      setStatus(`Connected to ${connected === 'spotify' ? 'Spotify' : 'Google'}!`);
    }
    const error = searchParams.get('error');
    if (error) {
      setStatus(formatAdminError(error));
    }
  }, [formatAdminError, params.venueId, searchParams]);

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
        setCrowdControlEnabled(settings.crowdControlEnabled ?? true);
        setActivePlaylistId(settings.activePlaylistId ?? null);
        setPlaylistPriority(settings.playlistPriority ?? false);
      }
    } catch (err) {
      console.error('Failed to load venue settings:', err);
    }
  }, [params.venueId]);

  const loadPendingSuggestions = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`/api/admin/${params.venueId}/suggestions?sessionId=${sessionId}`, {
        headers: { 'x-admin-password': adminToken },
      });
      if (res.ok) {
        const data = await res.json();
        setPendingSuggestions(data.suggestions ?? []);
      }
    } catch (err) {
      console.error('Failed to load pending suggestions:', err);
    }
  }, [adminToken, params.venueId]);

  const loadPayments = useCallback(async () => {
    if (!params.venueId) return;
    try {
      const res = await fetch(`/api/payments/history?venueId=${params.venueId}`);
      if (res.ok) {
        const data = await res.json();
        setPayments(data.payments ?? []);
      }
    } catch (err) {
      console.error('Failed to load payment history:', err);
    }
  }, [params.venueId]);

  const loadCreditTransactions = useCallback(async () => {
    if (!params.venueId || !adminToken) return;
    try {
      const res = await fetch(
        `/api/admin/${params.venueId}/credit-transactions?adminPassword=${encodeURIComponent(adminToken)}`,
      );
      if (res.ok) {
        const data = await res.json();
        setCreditTransactions(data.transactions ?? []);
      }
    } catch (err) {
      console.error('Failed to load credit transactions:', err);
    }
  }, [params.venueId, adminToken]);

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
      void (async () => {
        await load();
        await loadSettings();
        await loadPayments();
        await loadCreditTransactions();
      })();
    }
  }, [authed, load, loadSettings, loadPayments, loadCreditTransactions]);

  // Auto-import Spotify playlists when admin connects Spotify
  useEffect(() => {
    const connected = searchParams.get('connected');
    if (connected === 'spotify' && authed && adminToken) {
      fetch(`/api/admin/${params.venueId}/playlists/import-spotify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminPassword: adminToken }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.imported?.length > 0) {
            setStatus(`Connected to Spotify! Imported ${data.imported.length} playlist(s).`);
          }
        })
        .catch(() => {
          // Don't block the connection flow if import fails
        });
    }
  }, [searchParams, authed, adminToken, params.venueId]);

  useEffect(() => {
    if (!authed) return;
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [authed, load]);

  const sessionAction = async (action: 'start' | 'end') => {
    setLoading(true);
    setStatus(null);
    const res = await fetch(`/api/admin/${params.venueId}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminPassword: adminToken, action }),
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
    // If Spotify, update the track ID for the embedded player
    if (data.service === 'spotify' && data.trackId) {
      setCurrentSpotifyId(data.trackId);
    }
    await load();
    setLoading(false);
  };

  const handleSkip = async (requestId: string) => {
    if (!venueData?.activeSession) return;
    setLoading(true);
    const res = await fetch(`/api/admin/${params.venueId}/requests/${requestId}/skip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminPassword: adminToken }),
    });
    const data = await res.json();
    if (data.service === 'youtube' && data.trackId) {
      setCurrentYoutubeId(data.trackId);
    }
    if (data.service === 'spotify' && data.trackId) {
      setCurrentSpotifyId(data.trackId);
    }
    await load();
    setLoading(false);
  };

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
      body: JSON.stringify({ adminPassword: adminToken, songId }),
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
      body: JSON.stringify({ adminPassword: adminToken }),
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
      body: JSON.stringify({ adminPassword: adminToken, currentRequestId }),
    });

    const data = await res.json();
    if (res.ok && data.service === 'youtube') {
      setCurrentYoutubeId(data.nowPlaying.trackId); // Update YouTube player
    }
    if (res.ok && data.service === 'spotify') {
      setCurrentSpotifyId(data.nowPlaying.trackId); // Update Spotify embedded player
    }

    await load();
    setLoading(false);
  };

  const handleApproveSuggestion = async (requestId: string) => {
    setLoading(true);
    await fetch(`/api/admin/${params.venueId}/requests/${requestId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminPassword: adminToken }),
    });
    await load();
    setLoading(false);
  };

  const handleRejectSuggestion = async (requestId: string) => {
    setLoading(true);
    await fetch(`/api/admin/${params.venueId}/requests/${requestId}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminPassword: adminToken }),
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
      body: JSON.stringify({ adminPassword: adminToken, action, requestIds, sessionId }),
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
          adminPassword: adminToken,
          defaultBoostPrice,
          maxSongRepeatsPerHour,
          maxSongsPerUser,
          monetizationEnabled,
          smartMonetizationEnabled,
          suggestionModeEnabled,
          crowdControlEnabled,
          activePlaylistId,
          playlistPriority,
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

  /**
   * Immediately persist playlist settings (active playlist + priority) when changed
   * from the PlaylistManager UI, without requiring "Save Settings" click.
   */
  const handlePlaylistSettingsChange = async (
    newActivePlaylistId: string | null,
    newPlaylistPriority: boolean,
  ) => {
    setActivePlaylistId(newActivePlaylistId);
    setPlaylistPriority(newPlaylistPriority);
    try {
      await fetch(`/api/venues/${params.venueId}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminPassword: adminToken,
          activePlaylistId: newActivePlaylistId,
          playlistPriority: newPlaylistPriority,
        }),
      });
    } catch (err) {
      console.error('Failed to save playlist settings:', err);
    }
  };

  if (!authed) {
    return (
      <main className="min-h-screen bg-gray-950 text-white flex items-center justify-center p-6">
        <div className="max-w-sm w-full space-y-4 text-center">
          <h1 className="text-2xl font-bold">Admin Sign In</h1>
          <p className="text-sm text-gray-400">
            Use the Spotify or Google account already connected to this venue.
          </p>
          <div className="space-y-3">
            <a
              href="/api/admin/sign-in/spotify"
              className="block w-full rounded-lg bg-green-600 hover:bg-green-500 py-2 font-semibold transition-colors"
            >
              Continue with Spotify
            </a>
            <a
              href="/api/admin/sign-in/google"
              className="block w-full rounded-lg bg-white hover:bg-gray-100 text-gray-950 py-2 font-semibold transition-colors"
            >
              Continue with Google
            </a>
          </div>
          <p className="text-sm text-gray-500">
            Need to start over?{' '}
            <Link href="/admin/sign-in" className="text-green-400 hover:text-green-300">
              Go to admin sign in
            </Link>
          </p>
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
          password={adminToken}
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
          crowdControlEnabled={crowdControlEnabled}
          setCrowdControlEnabled={setCrowdControlEnabled}
          onSaveSettings={handleSaveSettings}
          settingsSaveStatus={settingsSaveStatus}
          // Playlist settings
          activePlaylistId={activePlaylistId}
          playlistPriority={playlistPriority}
          onPlaylistSettingsChange={handlePlaylistSettingsChange}
          // Active Users
          userCount={userCount}
          simulatedUsers={simulatedUsers}
          onSimulatedUsersChange={handleSimulatedUsersChange}
          smartSettings={smartMonetizationEnabled ? calculateSmartSettings(userCount + simulatedUsers) : null}
          // Now Playing & Queue
          youtubeVideoId={currentYoutubeId}
          spotifyTrackId={currentSpotifyId}
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

        {/* Payment History */}
        {payments.length > 0 && (
          <div className="bg-gray-900 rounded-xl p-4 space-y-3">
            <h2 className="font-semibold text-lg">💳 Payment History</h2>
            {/* Revenue Summary */}
            {(() => {
              const completed = payments.filter(p => p.status === 'COMPLETED');
              const refunded = payments.filter(p => p.status === 'REFUNDED');
              const totalRevenue = completed.reduce((sum, p) => sum + p.amount, 0);
              const venueRevenue = completed.reduce((sum, p) => sum + (p.venueShareAmount ?? 0), 0);
              const platformRevenue = completed.reduce((sum, p) => sum + (p.platformShareAmount ?? 0), 0);
              const totalRefunded = refunded.reduce((sum, p) => sum + p.amount, 0);
              return (
                <>
                  <div className="grid grid-cols-3 gap-2 bg-gray-800 rounded-lg p-3 text-center">
                    <div>
                      <p className="text-xs text-gray-400">Total</p>
                      <p className="font-semibold text-white">${totalRevenue.toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400">Venue Share</p>
                      <p className="font-semibold text-green-400">${venueRevenue.toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400">Platform Share</p>
                      <p className="font-semibold text-blue-400">${platformRevenue.toFixed(2)}</p>
                    </div>
                  </div>
                  {/* Refund Tracking */}
                  {refunded.length > 0 && (
                    <div className="bg-orange-950/40 border border-orange-700/50 rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-orange-300">🔄 Refund Tracking</p>
                        <span className="text-xs text-orange-400 bg-orange-900/40 rounded-full px-2 py-0.5">
                          {refunded.length} refund{refunded.length > 1 ? 's' : ''}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-400">Total refunded</span>
                        <span className="font-semibold text-orange-300">${totalRefunded.toFixed(2)}</span>
                      </div>
                      <p className="text-xs text-gray-500">
                        Refunds are issued automatically when boosted songs are not played (session ended, skipped, or removed).
                      </p>
                      <div className="space-y-1 max-h-32 overflow-y-auto">
                        {refunded.map((payment) => (
                          <div
                            key={payment.id}
                            className="flex items-center justify-between text-xs bg-orange-950/30 rounded px-2 py-1.5"
                          >
                            <div className="flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-orange-400" />
                              <span className="text-gray-400">Refunded boost</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-gray-500">
                                {new Date(payment.createdAt).toLocaleDateString()}
                              </span>
                              <span className="text-orange-300 font-semibold">
                                -${payment.amount.toFixed(2)}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
            {/* Individual payments */}
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {payments.map((payment) => (
                <div
                  key={payment.id}
                  className="flex items-center justify-between text-sm bg-gray-800 rounded-lg px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${
                      payment.status === 'COMPLETED' ? 'bg-green-500' :
                      payment.status === 'REFUNDED' ? 'bg-orange-500' :
                      payment.status === 'FAILED' ? 'bg-red-500' :
                      'bg-yellow-500'
                    }`} />
                    <span className="text-gray-300 capitalize">{payment.type.toLowerCase()}</span>
                    {payment.status === 'REFUNDED' && (
                      <span className="text-xs text-orange-400 font-medium">(refunded)</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-gray-400 text-xs">
                      {new Date(payment.createdAt).toLocaleDateString()}
                    </span>
                    <span className={`font-semibold ${
                      payment.status === 'COMPLETED' ? 'text-green-400' :
                      payment.status === 'REFUNDED' ? 'text-orange-400' :
                      payment.status === 'FAILED' ? 'text-red-400' :
                      'text-yellow-400'
                    }`}>
                      ${payment.amount.toFixed(2)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Credit Transaction History */}
        {creditTransactions.length > 0 && (
          <div className="bg-gray-900 rounded-xl p-4 space-y-3">
            <h2 className="font-semibold text-lg">🪙 Credit Transactions</h2>
            {/* Summary */}
            {(() => {
              const purchases = creditTransactions.filter(t => t.type === 'PURCHASE');
              const debits = creditTransactions.filter(t => t.type === 'BOOST_DEBIT');
              const totalPurchased = purchases.reduce((sum, t) => sum + t.amount, 0);
              const totalSpent = debits.reduce((sum, t) => sum + Math.abs(t.amount), 0);
              return (
                <div className="grid grid-cols-2 gap-2 bg-gray-800 rounded-lg p-3 text-center">
                  <div>
                    <p className="text-xs text-gray-400">Credits Purchased</p>
                    <p className="font-semibold text-green-400">{totalPurchased.toFixed(0)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Credits Spent</p>
                    <p className="font-semibold text-yellow-400">{totalSpent.toFixed(0)}</p>
                  </div>
                </div>
              );
            })()}
            {/* Individual credit transactions */}
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {creditTransactions.map((tx) => (
                <div
                  key={tx.id}
                  className="flex items-center justify-between text-sm bg-gray-800 rounded-lg px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-gray-300 truncate">
                      {tx.user.displayName
                        ? `DJ ${tx.user.displayName}`
                        : tx.user.email ?? 'Unknown user'}
                    </p>
                    {tx.description && (
                      <p className="text-xs text-gray-500 truncate">{tx.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3 ml-2 shrink-0">
                    <span className="text-gray-400 text-xs">
                      {new Date(tx.createdAt).toLocaleDateString()}
                    </span>
                    <span className={`font-semibold ${tx.amount > 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {tx.amount > 0 ? '+' : ''}{tx.amount.toFixed(0)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
