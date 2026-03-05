'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

type StreamingService = 'spotify' | 'youtube' | '';

export default function AdminSignUpPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);

  // Step 1 fields
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Step 2 fields
  const [venueName, setVenueName] = useState('');
  const [streamingService, setStreamingService] = useState<StreamingService>('');

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleStep1 = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setStep(2);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/admin/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          password,
          venueName,
          streamingService: streamingService || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Sign up failed');
      } else {
        sessionStorage.setItem(`adminPassword_${data.venueId}`, password);
        router.push(`/admin/${data.venueId}`);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-950 text-white flex items-center justify-center p-6">
      <div className="max-w-sm w-full space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-3xl font-bold">🎛️ Admin Sign Up</h1>
          <p className="text-gray-400 text-sm">
            Step {step} of 2 — {step === 1 ? 'Create your account' : 'Set up your venue'}
          </p>
        </div>

        {/* Step indicator */}
        <div className="flex gap-2">
          <div className={`flex-1 h-1 rounded-full ${step >= 1 ? 'bg-green-500' : 'bg-gray-700'}`} />
          <div className={`flex-1 h-1 rounded-full ${step >= 2 ? 'bg-green-500' : 'bg-gray-700'}`} />
        </div>

        {step === 1 && (
          <form onSubmit={handleStep1} className="space-y-4">
            <div className="space-y-1">
              <label className="block text-sm text-gray-400">Username</label>
              <input
                type="text"
                placeholder="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-green-500"
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
                className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-green-500"
                required
              />
            </div>
            <div className="space-y-1">
              <label className="block text-sm text-gray-400">Confirm Password</label>
              <input
                type="password"
                placeholder="Confirm password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-green-500"
                required
              />
            </div>
            {error && (
              <p className="text-red-400 text-sm text-center">{error}</p>
            )}
            <button
              type="submit"
              className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-2 rounded-lg transition-colors"
            >
              Next →
            </button>
          </form>
        )}

        {step === 2 && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label className="block text-sm text-gray-400">Venue Name</label>
              <input
                type="text"
                placeholder="e.g. Club Nexus"
                value={venueName}
                onChange={(e) => setVenueName(e.target.value)}
                className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-green-500"
                required
              />
            </div>
            <div className="space-y-2">
              <label className="block text-sm text-gray-400">Connect a Streaming Service</label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setStreamingService(streamingService === 'spotify' ? '' : 'spotify')}
                  className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-colors ${
                    streamingService === 'spotify'
                      ? 'border-green-500 bg-green-900/30 text-green-400'
                      : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-500'
                  }`}
                >
                  <span className="text-2xl">🎵</span>
                  <span className="text-sm font-medium">Spotify</span>
                </button>
                <button
                  type="button"
                  onClick={() => setStreamingService(streamingService === 'youtube' ? '' : 'youtube')}
                  className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-colors ${
                    streamingService === 'youtube'
                      ? 'border-red-500 bg-red-900/30 text-red-400'
                      : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-500'
                  }`}
                >
                  <span className="text-2xl">▶️</span>
                  <span className="text-sm font-medium">YouTube</span>
                </button>
              </div>
              <p className="text-xs text-gray-500">Optional — you can connect one later from your admin dashboard.</p>
            </div>
            {error && (
              <p className="text-red-400 text-sm text-center">{error}</p>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { setError(null); setStep(1); }}
                className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-semibold py-2 rounded-lg transition-colors"
              >
                ← Back
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-semibold py-2 rounded-lg transition-colors"
              >
                {loading ? 'Creating…' : 'Create Account'}
              </button>
            </div>
          </form>
        )}

        <p className="text-center text-sm text-gray-500">
          Already have an account?{' '}
          <Link href="/admin/sign-in" className="text-green-400 hover:text-green-300 transition-colors">
            Sign in →
          </Link>
        </p>
      </div>
    </main>
  );
}
