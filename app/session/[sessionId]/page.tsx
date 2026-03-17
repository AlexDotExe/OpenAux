'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { SongRequestForm } from '@/components/SongRequestForm';
import { SongQueue } from '@/components/SongQueue';
import { NowPlayingUser } from '@/components/NowPlayingUser';

interface PendingSuggestion {
  requestId: string;
  title: string;
  artist: string;
  userId: string;
  createdAt: string;
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
    isBoosted?: boolean;
    boostAmount?: number;
    userId?: string;
  }>;
  venueName?: string;
  suggestionModeEnabled?: boolean;
  pendingSuggestions?: PendingSuggestion[];
}

export default function SessionPage() {
  const params = useParams<{ sessionId: string }>();
  const { initDevice, setUser, setSession, setQueue, deviceFingerprint, queue, influenceWeight, userId } =
    useSessionStore();
  const [sessionData, setSessionData] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [boostPrice, setBoostPrice] = useState(5.0);
  const [monetizationEnabled, setMonetizationEnabled] = useState(false);
  const [userCount, setUserCount] = useState(0);
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
    const res = await fetch(`/api/sessions/${params.sessionId}`);
    const data: SessionData = await res.json();
    setSessionData(data);

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
    const fp = initDevice();
    // Ensure user is registered
    fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceFingerprint: fp }),
    })
      .then((r) => r.json())
      .then((user) => setUser(user.id, user.influenceWeight, user.reputationScore))
      .catch(console.error);

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
  }, [params.sessionId, initDevice, setUser, setSession, loadSession]);

  const handleVote = async (requestId: string, value: 1 | -1) => {
    if (!deviceFingerprint) return;
    const res = await fetch('/api/votes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId, deviceFingerprint, value }),
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
  const userPendingSuggestions = (sessionData.pendingSuggestions ?? []).filter(
    s => s.userId === userId
  );

  return (
    <main className="min-h-screen bg-gray-950 text-white pb-24">
      {/* Header */}
      <div className="sticky top-0 bg-gray-950/90 backdrop-blur border-b border-gray-800 p-4">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <Link href="/" className="text-lg font-bold text-green-400 hover:text-green-300 transition-colors">
            OpenAux
          </Link>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-300 font-semibold">
              🎵 {sessionData.venueName || 'Live Session'}
            </span>
          </div>
        </div>
      </div>

      <div className="max-w-md mx-auto p-4 space-y-6">
        {/* Guest Status */}
        <div className="bg-gray-900 rounded-xl p-3">
          <p className="text-sm text-gray-400">
            Logged in as <span className="text-white font-semibold">Guest</span>
          </p>
          <p className="text-xs text-gray-500 mt-1">
            <a href="/signup" className="text-green-400 hover:text-green-300 underline">
              Create an account
            </a>
            {' '}to save your settings and get priority voting
          </p>
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

        {/* Now Playing */}
        <NowPlayingUser sessionId={session.id} />

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
          onBoostSuccess={loadSession}
        />
      </div>
    </main>
  );
}
