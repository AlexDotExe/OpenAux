'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { SongRequestForm } from '@/components/SongRequestForm';
import { SongQueue } from '@/components/SongQueue';
import { NowPlayingUser } from '@/components/NowPlayingUser';
import { SessionExpiryWarning } from '@/components/SessionExpiryWarning';
import { SponsorSongBanner } from '@/components/SponsorSongBanner';
import { AuthModal } from '@/components/AuthModal';
import { UserProfileMenu } from '@/components/UserProfileMenu';
import { RefundPolicyNotice } from '@/components/RefundPolicyNotice';
import { MAX_DISPLAY_NAME_LENGTH } from '@/lib/constants';

interface PendingSuggestion {
  requestId: string;
  title: string;
  artist: string;
  userId: string;
  createdAt: string;
}

interface ActivePromotion {
  id: string;
  promotionText: string | null;
  promotionDurationMinutes: number;
  promotionActivatedAt: string;
  promotionExpiresAt: string;
  isAnthem: boolean;
  song: {
    title: string;
    artist: string;
    albumArtUrl?: string | null;
  };
}

interface SessionData {
  session: {
    id: string;
    venueId: string;
    currentEnergyLevel: number;
    isActive: boolean;
  };
  queue: Array<{
    requestId: string;
    songId: string;
    title: string;
    artist: string;
    score: number;
    voteCount: number;
    durationMs?: number;
    isBoosted?: boolean;
    boostAmount?: number;
    userId?: string;
  }>;
  venueName?: string;
  userSession?: {
    expiresAt: string;
    isExpired: boolean;
  } | null;
  suggestionModeEnabled?: boolean;
  crowdControlEnabled?: boolean;
  pendingSuggestions?: PendingSuggestion[];
  anthemAnnouncement?: {
    type: 'upcoming';
    title: string;
    artist: string;
    promotionText: string | null;
    isAnthem: boolean;
  } | null;
  activePromotion?: ActivePromotion | null;
}

export default function SessionPage() {
  const params = useParams<{ sessionId: string }>();
  const { initDevice, setUser, setSession, setQueue, deviceFingerprint, queue, influenceWeight, userId, displayName, setDisplayName, isAuthenticated, setAuthUser, loadAuthFromStorage } =
    useSessionStore();
  const [sessionData, setSessionData] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [boostPrice, setBoostPrice] = useState(5.0);
  const [monetizationEnabled, setMonetizationEnabled] = useState(false);
  const [userCount, setUserCount] = useState(0);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [isExpired, setIsExpired] = useState(false);
  const [djNameInput, setDjNameInput] = useState('');
  const [djNameSaving, setDjNameSaving] = useState(false);
  const [djNameSaved, setDjNameSaved] = useState(false);
  const [nowPlayingRemainingMs, setNowPlayingRemainingMs] = useState<number>(0);
  const [showAuthModal, setShowAuthModal] = useState(false);
  // Track recently approved/rejected suggestions for user notifications
  const [approvedNotifications, setApprovedNotifications] = useState<{ title: string; artist: string }[]>([]);
  const [rejectedNotifications, setRejectedNotifications] = useState<{ title: string; artist: string }[]>([]);
  // Map of requestId -> song info for previously seen pending suggestions (owned by this user)
  const prevUserPendingRef = useRef<Map<string, { title: string; artist: string }>>(new Map());

  const loadEffectiveSettings = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/effective-settings`);
      if (res.ok) {
        const settings = await res.json();
        console.log('[SessionPage] Effective settings loaded:', settings);
        setBoostPrice(settings.boostPrice ?? 0);
        setMonetizationEnabled(settings.monetizationEnabled ?? false);
      }
    } catch (err) {
      console.error('Failed to load effective settings:', err);
    }
  }, []);

  const loadSession = useCallback(async (updatedQueue?: any[]) => {
    const currentUserId = useSessionStore.getState().userId;
    const url = currentUserId
      ? `/api/sessions/${params.sessionId}?userId=${encodeURIComponent(currentUserId)}`
      : `/api/sessions/${params.sessionId}`;

    const res = await fetch(url);
    const data: SessionData = await res.json();
    setSessionData(data);

    // Update expiry state from server
    if (data.userSession) {
      setExpiresAt(data.userSession.expiresAt);
      setIsExpired(data.userSession.isExpired);
    }

    // Use the provided queue if available, otherwise use fetched queue
    const queueToUse = updatedQueue ?? data.queue;
    setQueue(queueToUse);

    // Count unique users
    const uniqueUsers = new Set(queueToUse?.map(item => item.userId).filter(Boolean));
    setUserCount(uniqueUsers.size);

    // Load effective settings (smart or manual)
    await loadEffectiveSettings(params.sessionId);
  }, [params.sessionId, setQueue, loadEffectiveSettings]);

  // Detect approved/rejected suggestions for this user by comparing previous pending list
  const currentUserIdRef = useRef<string | null>(null);
  useEffect(() => {
    currentUserIdRef.current = userId ?? null;
  }, [userId]);

  useEffect(() => {
    if (!sessionData?.suggestionModeEnabled || !currentUserIdRef.current) return;

    const currentPending = sessionData.pendingSuggestions ?? [];
    const currentPendingMap = new Map(
      currentPending
        .filter(s => s.userId === currentUserIdRef.current)
        .map(s => [s.requestId, { title: s.title, artist: s.artist }])
    );

    const approvedQueue = sessionData.queue ?? [];
    const queueRequestIds = new Set(approvedQueue.map(q => q.requestId));

    // Check what changed since last poll
    const prevPending = prevUserPendingRef.current;
    const newlyApproved: { title: string; artist: string }[] = [];
    const newlyRejected: { title: string; artist: string }[] = [];

    prevPending.forEach((info, requestId) => {
      if (!currentPendingMap.has(requestId)) {
        // Was pending, now gone — either approved (in queue) or rejected (not in queue)
        if (queueRequestIds.has(requestId)) {
          newlyApproved.push(info);
        } else {
          newlyRejected.push(info);
        }
      }
    });

    if (newlyApproved.length > 0) {
      setApprovedNotifications(prev => [...prev, ...newlyApproved]);
      setTimeout(() => setApprovedNotifications(prev => prev.filter((_, i) => i >= newlyApproved.length)), 5000);
    }
    if (newlyRejected.length > 0) {
      setRejectedNotifications(prev => [...prev, ...newlyRejected]);
      setTimeout(() => setRejectedNotifications(prev => prev.filter((_, i) => i >= newlyRejected.length)), 5000);
    }

    // Update ref with current user's pending suggestions
    prevUserPendingRef.current = currentPendingMap;
  }, [sessionData]);

  useEffect(() => {
    // Handle OAuth callback: pick up auth token from short-lived cookie
    // (set by the callback route to avoid token exposure in URL / browser history)
    const getCookie = (name: string) =>
      document.cookie.split('; ').find(r => r.startsWith(`${name}=`))?.split('=').slice(1).join('=');

    const pendingToken = getCookie('_pending_auth_token');
    const pendingProvider = getCookie('_pending_auth_provider');
    const pendingUserId = getCookie('_pending_auth_user_id');
    const pendingNonce = getCookie('_pending_auth_nonce');

    if (pendingToken && pendingUserId) {
      // Verify CSRF nonce if present
      const storedNonce = sessionStorage.getItem('oauth_nonce');
      if (pendingNonce && storedNonce && pendingNonce !== storedNonce) {
        console.error('[Auth] OAuth nonce mismatch — possible CSRF attack');
        document.cookie = '_pending_auth_token=; Max-Age=0; Path=/';
        document.cookie = '_pending_auth_provider=; Max-Age=0; Path=/';
        document.cookie = '_pending_auth_user_id=; Max-Age=0; Path=/';
        document.cookie = '_pending_auth_nonce=; Max-Age=0; Path=/';
        sessionStorage.removeItem('oauth_nonce');
        return;
      }

      // Clear the pending cookies and nonce immediately
      document.cookie = '_pending_auth_token=; Max-Age=0; Path=/';
      document.cookie = '_pending_auth_provider=; Max-Age=0; Path=/';
      document.cookie = '_pending_auth_user_id=; Max-Age=0; Path=/';
      document.cookie = '_pending_auth_nonce=; Max-Age=0; Path=/';
      sessionStorage.removeItem('oauth_nonce');

      // Fetch full user info and store token (default: session-only since we can't
      // know the stayLoggedIn preference from the OAuth redirect)
      fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${pendingToken}` },
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.userId) {
            setAuthUser({
              userId: data.userId,
              authToken: pendingToken,
              email: data.email ?? null,
              authProvider: pendingProvider ?? data.authProvider ?? null,
              displayName: data.displayName ?? null,
              reputationScore: data.reputationScore,
              influenceWeight: data.influenceWeight,
              creditBalance: data.creditBalance,
              stayLoggedIn: false, // OAuth sign-in defaults to session-only storage
            });
            setDjNameInput(data.displayName ?? '');
            // Join the session with the authenticated user ID
            return fetch(`/api/sessions/${params.sessionId}/join`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId: data.userId }),
            });
          }
        })
        .then((r) => r?.json())
        .then((userSession) => {
          if (userSession) {
            setExpiresAt(userSession.expiresAt);
            setIsExpired(userSession.isExpired);
          }
        })
        .catch(console.error);
      return;
    }

    // Check for a stored auth token from a previous session
    const storedToken = loadAuthFromStorage();
    if (storedToken) {
      // Determine if the token was stored persistently (localStorage) or temporarily (sessionStorage)
      const isPersistent =
        typeof window !== 'undefined' &&
        localStorage.getItem('vdj_auth_token') === storedToken;
      fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${storedToken}` },
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data?.userId) {
            setAuthUser({
              userId: data.userId,
              authToken: storedToken,
              email: data.email ?? null,
              authProvider: data.authProvider ?? null,
              displayName: data.displayName ?? null,
              reputationScore: data.reputationScore,
              influenceWeight: data.influenceWeight,
              creditBalance: data.creditBalance,
              stayLoggedIn: isPersistent,
            });
            setDjNameInput(data.displayName ?? '');
            return fetch(`/api/sessions/${params.sessionId}/join`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId: data.userId }),
            });
          }
          // Token invalid; fall back to device fingerprint
          return null;
        })
        .then((r) => r?.json())
        .then((userSession) => {
          if (userSession) {
            setExpiresAt(userSession.expiresAt);
            setIsExpired(userSession.isExpired);
          }
        })
        .catch(console.error);
      return;
    }

    const fp = initDevice();
    // Ensure user is registered, then join the session
    fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceFingerprint: fp }),
    })
      .then((r) => r.json())
      .then((user) => {
        setUser(user.id, user.influenceWeight, user.reputationScore, user.displayName);
        setDjNameInput(user.displayName ?? '');
        // Join (or rejoin) the user session to establish/reset the expiry timer
        return fetch(`/api/sessions/${params.sessionId}/join`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user.id }),
        });
      })
      .then((r) => r.json())
      .then((userSession) => {
        setExpiresAt(userSession.expiresAt);
        setIsExpired(userSession.isExpired);
      })
      .catch(console.error);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.sessionId]);

  // Session polling and initial load
  useEffect(() => {
    loadSession()
      .then(() => {
        setSession(params.sessionId, '', 0.5);
      })
      .catch(console.error)
      .finally(() => setLoading(false));

    // Poll for updates every 5 seconds
    // Scaling Path: Replace with WebSocket subscription
    const interval = setInterval(loadSession, 5000);
    return () => clearInterval(interval);
  }, [params.sessionId, setSession, loadSession]);

  const handleSaveDjName = async () => {
    if (!userId || !djNameInput.trim()) return;
    setDjNameSaving(true);
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: djNameInput.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setDisplayName(data.displayName);
        setDjNameSaved(true);
        setTimeout(() => setDjNameSaved(false), 2000);
      }
    } catch (err) {
      console.error('Failed to save DJ name:', err);
    } finally {
      setDjNameSaving(false);
    }
  };

  const handleVote = async (requestId: string, value: 1 | -1) => {
    if (!deviceFingerprint) return;
    const res = await fetch('/api/votes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId, sessionId: params.sessionId, deviceFingerprint, value }),
    });
    if (res.ok) {
      useSessionStore.getState().updateUserVote(requestId, value);
      await loadSession();
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        <p className="animate-pulse text-gray-400">Joining session...</p>
      </div>
    );
  }

  if (!sessionData) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        <p className="text-red-400">Session not found</p>
      </div>
    );
  }

  const { session } = sessionData;
  const suggestionModeEnabled = sessionData.suggestionModeEnabled ?? false;
  const crowdControlEnabled = sessionData.crowdControlEnabled ?? true;
  const userPendingSuggestions = (sessionData.pendingSuggestions ?? []).filter(
    s => s.userId === userId
  );

  return (
    <main className="min-h-screen bg-gray-950 text-white pb-24">
      {/* Session Expired / Expiry Warning */}
      <SessionExpiryWarning expiresAt={expiresAt} isExpired={isExpired} />

      {/* Auth Modal */}
      {showAuthModal && (
        <AuthModal
          onClose={() => setShowAuthModal(false)}
          returnUrl={`/session/${params.sessionId}`}
        />
      )}

      {/* Header */}
      <div className="sticky top-0 bg-gray-950/90 backdrop-blur border-b border-gray-800 p-4">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <Link href="/" className="text-lg font-bold text-green-400 hover:text-green-300 transition-colors">
            OpenAux
          </Link>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-300 font-semibold">
              🎵 {sessionData.venueName || 'Live Session'}
            </span>
            {isAuthenticated ? (
              <UserProfileMenu />
            ) : (
              <button
                onClick={() => setShowAuthModal(true)}
                className="text-xs font-semibold text-gray-400 hover:text-green-400 transition-colors border border-gray-700 hover:border-green-600 rounded-lg px-2.5 py-1"
              >
                Sign In
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-md mx-auto p-4 space-y-6">
        {/* Guest / DJ name section */}
        <div className="bg-gray-900 rounded-xl p-3">
          <p className="text-sm text-gray-400">
            {isAuthenticated ? (
              <>Signed in as <span className="text-green-400 font-semibold">{displayName ? `DJ ${displayName}` : 'you'}</span></>
            ) : (
              <>Playing as <span className="text-white font-semibold">{displayName ? `DJ ${displayName}` : 'Guest'}</span>{' '}
              — <button onClick={() => setShowAuthModal(true)} className="text-green-400 hover:text-green-300 underline underline-offset-2">sign in</button> to save your stats</>
            )}
          </p>
          <div className="mt-2 flex gap-2">
            <input
              type="text"
              value={djNameInput}
              onChange={(e) => setDjNameInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveDjName()}
              placeholder="Set your DJ name..."
              maxLength={MAX_DISPLAY_NAME_LENGTH}
              className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500"
            />
            <button
              onClick={handleSaveDjName}
              disabled={djNameSaving || !djNameInput.trim()}
              className="px-3 py-1 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm rounded font-semibold transition-colors"
            >
              {djNameSaved ? '✓' : djNameSaving ? '...' : 'Save'}
            </button>
          </div>
        </div>

        {/* Suggestion mode banner */}
        {suggestionModeEnabled && (
          <div className="bg-purple-900/30 border border-purple-700 rounded-xl p-3">
            <p className="text-sm text-purple-300 font-semibold">🎵 Suggestion Mode Active</p>
            <p className="text-xs text-purple-400 mt-1">
              Your requests go to the venue for approval before entering the queue.
            </p>
          </div>
        )}

        {/* Crowd Control mode banner */}
        {crowdControlEnabled && (
          <div className="bg-blue-900/30 border border-blue-700 rounded-xl p-3">
            <p className="text-sm text-blue-300 font-semibold">🗳 Crowd Control Mode</p>
            <p className="text-xs text-blue-400 mt-1">
              Queue order is determined entirely by your votes and boosts!
            </p>
          </div>
        )}

        {/* Approval/Rejection notifications */}
        {approvedNotifications.map((n, i) => (
          <div key={i} className="bg-green-900/30 border border-green-700 rounded-xl p-3 animate-pulse">
            <p className="text-sm text-green-300">
              ✅ Your suggestion &ldquo;{n.title}&rdquo; was approved and added to the queue!
            </p>
          </div>
        ))}
        {rejectedNotifications.map((n, i) => (
          <div key={i} className="bg-red-900/30 border border-red-700 rounded-xl p-3">
            <p className="text-sm text-red-300">
              ❌ Your suggestion &ldquo;{n.title}&rdquo; was not approved.
            </p>
          </div>
        ))}

        {/* Refund Policy Notice — shown when the user has boosted songs in the queue */}
        <RefundPolicyNotice
          boostedSongCount={
            (sessionData.queue ?? []).filter(
              (item) => item.isBoosted && item.userId === userId,
            ).length
          }
        />

        {/* Now Playing */}
        <NowPlayingUser sessionId={session.id} onPlaybackUpdate={setNowPlayingRemainingMs} />

        {/* Anthem / Sponsor Song "Coming Up Next" Announcement */}
        {sessionData.anthemAnnouncement && (
          <div className="bg-amber-900/40 border-2 border-amber-500 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-2xl">{sessionData.anthemAnnouncement.isAnthem ? '🎺' : '⭐'}</span>
              <p className="text-amber-300 font-bold">
                {sessionData.anthemAnnouncement.isAnthem ? 'Venue Anthem Coming Up Next!' : 'Sponsor Song Coming Up Next!'}
              </p>
            </div>
            <p className="text-amber-100 text-sm mt-1 pl-9">
              {sessionData.anthemAnnouncement.title} — {sessionData.anthemAnnouncement.artist}
            </p>
            {sessionData.anthemAnnouncement.promotionText && (
              <p className="text-amber-400 text-sm mt-2 pl-9">
                🎁 {sessionData.anthemAnnouncement.promotionText}
              </p>
            )}
          </div>
        )}

        {/* Active Sponsor Promotion Banner (time-limited promotion currently running) */}
        <SponsorSongBanner activePromotion={sessionData.activePromotion ?? null} />

        {/* Song Request Form */}
        <SongRequestForm sessionId={session.id} venueId={session.venueId} onRequestSubmitted={loadSession} />

        {/* User's pending suggestions (suggestion mode only) */}
        {suggestionModeEnabled && userPendingSuggestions.length > 0 && (
          <div className="space-y-2">
            <h2 className="font-semibold text-purple-300">⏳ Awaiting Approval</h2>
            {userPendingSuggestions.map(s => (
              <div key={s.requestId} className="bg-purple-900/20 border border-purple-700 rounded-xl p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{s.title}</p>
                  <p className="text-gray-400 text-xs truncate">{s.artist}</p>
                </div>
                <span className="text-xs text-purple-400 shrink-0">Pending…</span>
              </div>
            ))}
          </div>
        )}

        {/* Song Queue */}
        <SongQueue
          queue={queue}
          onVote={handleVote}
          currentUserId={userId ?? undefined}
          boostPrice={boostPrice}
          monetizationEnabled={monetizationEnabled}
          nowPlayingRemainingMs={nowPlayingRemainingMs}
          onBoostSuccess={loadSession}
        />
      </div>
    </main>
  );
}
