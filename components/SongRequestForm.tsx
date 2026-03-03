'use client';

import { useState } from 'react';
import { useSessionStore } from '@/lib/store/useSessionStore';

interface Props {
  sessionId: string;
  onRequestSubmitted: () => void;
}

export function SongRequestForm({ sessionId, onRequestSubmitted }: Props) {
  const { deviceFingerprint, userId } = useSessionStore();
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || !deviceFingerprint) return;
    setLoading(true);
    setError(null);

    const res = await fetch('/api/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, userId, title, artist }),
    });

    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error ?? 'Failed to submit request');
    } else {
      setSuccess(true);
      setTitle('');
      setArtist('');
      onRequestSubmitted();
      setTimeout(() => setSuccess(false), 3000);
    }
  };

  return (
    <div className="bg-gray-900 rounded-xl p-4">
      <h2 className="font-semibold mb-3">🎤 Request a Song</h2>
      <form onSubmit={handleSubmit} className="space-y-3">
        <input
          type="text"
          placeholder="Song title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 text-sm placeholder-gray-500 outline-none focus:ring-2 focus:ring-purple-500"
        />
        <input
          type="text"
          placeholder="Artist name"
          value={artist}
          onChange={(e) => setArtist(e.target.value)}
          required
          className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 text-sm placeholder-gray-500 outline-none focus:ring-2 focus:ring-purple-500"
        />
        {error && <p className="text-red-400 text-sm">{error}</p>}
        {success && <p className="text-green-400 text-sm">✅ Request submitted!</p>}
        <button
          type="submit"
          disabled={loading || !title || !artist}
          className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-semibold py-2 rounded-lg transition-colors"
        >
          {loading ? 'Submitting...' : 'Request Song'}
        </button>
      </form>
    </div>
  );
}
