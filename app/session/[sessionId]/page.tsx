'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { SongRequestForm } from '@/components/SongRequestForm';
import { SongQueue } from '@/components/SongQueue';

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
  }>;
}

export default function SessionPage() {
  const params = useParams<{ sessionId: string }>();
  const { initDevice, setUser, setSession, setQueue, deviceFingerprint, queue, influenceWeight } =
    useSessionStore();
  const [sessionData, setSessionData] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);

  const loadSession = useCallback(async () => {
    const res = await fetch(`/api/sessions/${params.sessionId}`);
    const data: SessionData = await res.json();
    setSessionData(data);
    setQueue(data.queue);
  }, [params.sessionId, setQueue]);

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

  return (
    <main className="min-h-screen bg-gray-950 text-white pb-24">
      {/* Header */}
      <div className="sticky top-0 bg-gray-950/90 backdrop-blur border-b border-gray-800 p-4">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <h1 className="text-lg font-bold">🎵 Live Session</h1>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Energy</span>
            <div className="w-20 h-2 bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-purple-500 rounded-full transition-all"
                style={{ width: `${session.currentEnergyLevel * 100}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-md mx-auto p-4 space-y-6">
        {/* Influence indicator */}
        <div className="bg-gray-900 rounded-xl p-3 flex items-center justify-between">
          <span className="text-sm text-gray-400">Your Influence</span>
          <span className="text-purple-400 font-semibold text-sm">
            ×{influenceWeight.toFixed(2)}
          </span>
        </div>

        {/* Song Request Form */}
        <SongRequestForm sessionId={session.id} onRequestSubmitted={loadSession} />

        {/* Song Queue */}
        <SongQueue queue={queue} onVote={handleVote} />
      </div>
    </main>
  );
}
