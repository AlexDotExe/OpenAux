'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSessionStore } from '@/lib/store/useSessionStore';

interface VenueData {
  venue: {
    id: string;
    name: string;
    genreProfile: { primary?: string; secondary?: string[] };
    bpmRange: { min: number; max: number };
  };
  activeSession: {
    id: string;
    currentEnergyLevel: number;
    isActive: boolean;
  } | null;
}

export default function VenuePage() {
  const params = useParams<{ venueId: string }>();
  const router = useRouter();
  const { initDevice, setUser, setSession } = useSessionStore();
  const [data, setData] = useState<VenueData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fp = initDevice();
    // Register/fetch the user
    fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceFingerprint: fp }),
    })
      .then((r) => r.json())
      .then((user) => {
        setUser(user.id, user.influenceWeight, user.reputationScore);
      })
      .catch(console.error);

    fetch(`/api/venues/${params.venueId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setData(d);
        if (d.activeSession) {
          setSession(d.activeSession.id, params.venueId, d.activeSession.currentEnergyLevel);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [params.venueId, initDevice, setUser, setSession]);

  if (loading)
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        <p className="animate-pulse text-gray-400">Loading...</p>
      </div>
    );

  if (error || !data)
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        <p className="text-red-400">{error ?? 'Venue not found'}</p>
      </div>
    );

  const { venue, activeSession } = data;

  return (
    <main className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-md mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold">{venue.name}</h1>
          {venue.genreProfile?.primary && (
            <p className="text-purple-400 mt-1">{venue.genreProfile.primary}</p>
          )}
        </div>

        {activeSession ? (
          <div className="space-y-4">
            <div className="bg-green-900/30 border border-green-700 rounded-xl p-4">
              <p className="text-green-400 font-semibold">🟢 Live Session Active</p>
              <p className="text-gray-300 text-sm mt-1">
                Energy Level: {Math.round(activeSession.currentEnergyLevel * 100)}%
              </p>
            </div>
            <button
              onClick={() => router.push(`/session/${activeSession.id}`)}
              className="w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold py-4 rounded-xl transition-colors text-lg"
            >
              Join the Session 🎧
            </button>
          </div>
        ) : (
          <div className="bg-gray-900 rounded-xl p-4 text-center">
            <p className="text-gray-400">No active session right now.</p>
            <p className="text-gray-500 text-sm mt-1">Check back when the venue opens!</p>
          </div>
        )}
      </div>
    </main>
  );
}
