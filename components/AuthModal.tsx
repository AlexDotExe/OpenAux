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
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
            </svg>
            Continue with Spotify
          </button>
          <button
            onClick={handleInstagramOAuth}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
            </svg>
            Continue with Instagram
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
