'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { SongRequestForm } from '@/components/SongRequestForm';
import { SongQueue } from '@/components/SongQueue';
import { NowPlayingUser } from '@/components/NowPlayingUser';
import { SessionExpiryWarning } from '@/components/SessionExpiryWarning';

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
  userSession?: {
    expiresAt: string;
    isExpired: boolean;
  } | null;
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
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [isExpired, setIsExpired] = useState(false);

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

  useEffect(() => {
    const fp = initDevice();
    // Ensure user is registered, then join the session
    fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceFingerprint: fp }),
    })
      .then((r) => r.json())
      .then((user) => {
        setUser(user.id, user.influenceWeight, user.reputationScore);
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

  return (
    <main className="min-h-screen bg-gray-950 text-white pb-24">
      {/* Session Expired / Expiry Warning */}
      <SessionExpiryWarning expiresAt={expiresAt} isExpired={isExpired} />

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

        {/* Now Playing */}
        <NowPlayingUser sessionId={session.id} />

        {/* Song Request Form */}
        <SongRequestForm sessionId={session.id} venueId={session.venueId} onRequestSubmitted={loadSession} />

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
