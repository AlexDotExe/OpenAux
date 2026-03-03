'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';

interface VenueData {
  venue: { id: string; name: string };
  activeSession: {
    id: string;
    currentEnergyLevel: number;
    isActive: boolean;
  } | null;
}

interface QueueItem {
  requestId: string;
  songId: string;
  title: string;
  artist: string;
  score: number;
  voteCount: number;
}

export default function AdminPage() {
  const params = useParams<{ venueId: string }>();
  const [password, setPassword] = useState('');
  const [authed, setAuthed] = useState(false);
  const [venueData, setVenueData] = useState<VenueData | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [energySlider, setEnergySlider] = useState(0.5);
  const [status, setStatus] = useState<string | null>(null);
  const [origin, setOrigin] = useState('');

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const load = useCallback(async () => {
    if (!params.venueId) return;
    const res = await fetch(`/api/venues/${params.venueId}`);
    const data: VenueData = await res.json();
    setVenueData(data);
    if (data.activeSession) {
      setEnergySlider(data.activeSession.currentEnergyLevel);
      const sessRes = await fetch(`/api/sessions/${data.activeSession.id}`);
      const sessData = await sessRes.json();
      setQueue(sessData.queue ?? []);
    }
  }, [params.venueId]);

  useEffect(() => {
    if (authed) load();
  }, [authed, load]);

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
    setStatus(res.ok ? `✅ Session ${action}ed` : `❌ ${data.error}`);
    await load();
    setLoading(false);
  };

  const handleSkip = async (requestId: string) => {
    if (!venueData?.activeSession) return;
    setLoading(true);
    await fetch(`/api/sessions/${venueData.activeSession.id}/advance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentRequestId: requestId, wasSkipped: true }),
    });
    await load();
    setLoading(false);
  };

  const handleEnergyChange = async (value: number) => {
    setEnergySlider(value);
    if (!venueData?.activeSession) return;
    await fetch(`/api/sessions/${venueData.activeSession.id}/energy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: value }),
    });
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

  if (!authed) {
    return (
      <main className="min-h-screen bg-gray-950 text-white flex items-center justify-center p-6">
        <div className="max-w-sm w-full space-y-4">
          <h1 className="text-2xl font-bold text-center">🎛️ Admin</h1>
          <form onSubmit={handleAuth} className="space-y-3">
            <input
              type="password"
              placeholder="Admin password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-purple-500"
            />
            <button
              type="submit"
              className="w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold py-2 rounded-lg"
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
          <h1 className="text-2xl font-bold">🎛️ {venueData?.venue.name} — Admin</h1>
        </div>

        {status && (
          <div className="bg-gray-800 rounded-xl p-3 text-sm">{status}</div>
        )}

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

        {/* Energy Slider */}
        {venueData?.activeSession && (
          <div className="bg-gray-900 rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Energy Level</h2>
              <span className="text-purple-400 font-mono">{Math.round(energySlider * 100)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={energySlider}
              onChange={(e) => handleEnergyChange(parseFloat(e.target.value))}
              className="w-full accent-purple-500"
            />
          </div>
        )}

        {/* Live Queue */}
        {queue.length > 0 && (
          <div className="bg-gray-900 rounded-xl p-4 space-y-3">
            <h2 className="font-semibold">Live Queue</h2>
            {queue.map((item, idx) => (
              <div key={item.requestId} className="flex items-center gap-3">
                <span className="text-gray-600 text-sm w-5">{idx + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate text-sm">{item.title}</p>
                  <p className="text-gray-400 text-xs truncate">{item.artist}</p>
                </div>
                <span className="text-xs text-gray-500">{item.score.toFixed(1)}</span>
                <button
                  onClick={() => handleSkip(item.requestId)}
                  className="text-xs bg-gray-800 hover:bg-red-900 px-2 py-1 rounded"
                >
                  Skip
                </button>
                <button
                  onClick={() => handleBlacklist(item.songId)}
                  className="text-xs bg-gray-800 hover:bg-red-900 px-2 py-1 rounded"
                >
                  🚫
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
