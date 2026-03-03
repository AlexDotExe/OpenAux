'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Venue {
  id: string;
  name: string;
}

export default function AdminSignInPage() {
  const router = useRouter();
  const [venues, setVenues] = useState<Venue[]>([]);
  const [venueId, setVenueId] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/venues')
      .then((r) => r.json())
      .then((data: Venue[]) => {
        setVenues(data);
        if (data.length > 0) setVenueId(data[0].id);
      })
      .catch(() => setError('Failed to load venues. Please refresh.'));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, venueId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Sign in failed');
      } else {
        sessionStorage.setItem(`adminPassword_${venueId}`, password);
        router.push(`/admin/${venueId}`);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-950 text-white flex items-center justify-center p-6">
      <div className="max-w-sm w-full space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-3xl font-bold">🎛️ Admin Sign In</h1>
          <p className="text-gray-400 text-sm">Sign in to manage your venue</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          {venues.length > 0 && (
            <div className="space-y-1">
              <label className="block text-sm text-gray-400">Venue</label>
              <select
                value={venueId}
                onChange={(e) => setVenueId(e.target.value)}
                className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-purple-500"
                required
              >
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="space-y-1">
            <label className="block text-sm text-gray-400">Username</label>
            <input
              type="text"
              placeholder="admin"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-purple-500"
              required
            />
          </div>
          <div className="space-y-1">
            <label className="block text-sm text-gray-400">Password</label>
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-purple-500"
              required
            />
          </div>
          {error && (
            <p className="text-red-400 text-sm text-center">{error}</p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-semibold py-2 rounded-lg transition-colors"
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </main>
  );
}
