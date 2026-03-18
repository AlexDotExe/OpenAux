'use client';

import { useState } from 'react';
import { useSessionStore } from '@/lib/store/useSessionStore';

interface AuthModalProps {
  onClose: () => void;
  returnUrl?: string;
}

type AuthTab = 'signin' | 'signup';

export function AuthModal({ onClose, returnUrl = '/' }: AuthModalProps) {
  const { setAuthUser } = useSessionStore();

  const [tab, setTab] = useState<AuthTab>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [stayLoggedIn, setStayLoggedIn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const endpoint = tab === 'signup' ? '/api/auth/register' : '/api/auth/signin';
      const body =
        tab === 'signup'
          ? { email, password, displayName: displayName || undefined }
          : { email, password };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Something went wrong');
        return;
      }

      setAuthUser({
        userId: data.userId,
        authToken: data.authToken,
        email: data.email,
        authProvider: data.authProvider,
        displayName: data.displayName,
        reputationScore: data.reputationScore,
        influenceWeight: data.influenceWeight,
        creditBalance: data.creditBalance,
        stayLoggedIn,
      });

      onClose();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const buildOAuthState = () => {
    // Generate a random nonce for basic CSRF protection
    const nonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('oauth_nonce', nonce);
    }
    return Buffer.from(JSON.stringify({ returnUrl, nonce })).toString('base64');
  };

  const handleInstagramOAuth = () => {
    const clientId = process.env.NEXT_PUBLIC_INSTAGRAM_CLIENT_ID;
    if (!clientId) {
      setError('Instagram sign-in is not configured.');
      return;
    }
    const baseUrl = window.location.origin;
    const redirectUri = encodeURIComponent(`${baseUrl}/api/auth/callback/instagram`);
    const state = buildOAuthState();
    const scope = encodeURIComponent('user_profile,user_media');
    window.location.href = `https://api.instagram.com/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&scope=${scope}&response_type=code&state=${state}`;
  };

  const handleSpotifyOAuth = () => {
    const clientId =
      process.env.NEXT_PUBLIC_SPOTIFY_USER_CLIENT_ID ||
      process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID;
    if (!clientId) {
      setError('Spotify sign-in is not configured.');
      return;
    }
    const baseUrl = window.location.origin;
    const redirectUri = encodeURIComponent(`${baseUrl}/api/auth/callback/spotify`);
    const state = buildOAuthState();
    const scope = encodeURIComponent('user-read-private user-read-email');
    window.location.href = `https://accounts.spotify.com/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&scope=${scope}&response_type=code&state=${state}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-sm p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-white">
            {tab === 'signin' ? 'Sign In' : 'Create Account'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors text-xl leading-none"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex rounded-lg bg-gray-800 p-1 mb-5">
          <button
            onClick={() => { setTab('signin'); setError(null); }}
            className={`flex-1 py-1.5 text-sm font-semibold rounded-md transition-colors ${
              tab === 'signin' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            Sign In
          </button>
          <button
            onClick={() => { setTab('signup'); setError(null); }}
            className={`flex-1 py-1.5 text-sm font-semibold rounded-md transition-colors ${
              tab === 'signup' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            Sign Up
          </button>
        </div>

        {/* OAuth Buttons */}
        <div className="space-y-2 mb-4">
          <button
            onClick={handleSpotifyOAuth}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-green-600 hover:bg-green-500 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            <span>🎵</span> Continue with Spotify
          </button>
          <button
            onClick={handleInstagramOAuth}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            <span>📸</span> Continue with Instagram
          </button>
        </div>

        <div className="flex items-center gap-3 my-4">
          <div className="flex-1 h-px bg-gray-700" />
          <span className="text-xs text-gray-500">or</span>
          <div className="flex-1 h-px bg-gray-700" />
        </div>

        {/* Email/Password Form */}
        <form onSubmit={handleEmailAuth} className="space-y-3">
          {tab === 'signup' && (
            <input
              type="text"
              placeholder="Display name (optional)"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500"
            />
          )}
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500"
          />

          {/* Stay Logged In */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={stayLoggedIn}
              onChange={(e) => setStayLoggedIn(e.target.checked)}
              className="w-4 h-4 accent-green-500"
            />
            <span className="text-sm text-gray-300">Stay logged in</span>
          </label>

          {/* Error message */}
          {error && (
            <p className="text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            {loading ? 'Please wait…' : tab === 'signin' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <p className="mt-4 text-xs text-gray-500 text-center">
          Sign in is optional — you can always use OpenAux as a guest.
        </p>
      </div>
    </div>
  );
}
