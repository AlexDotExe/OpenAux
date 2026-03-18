'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

const errorMessages: Record<string, string> = {
  invalid_state: 'Your sign-in session expired. Please try again.',
  spotify_denied: 'Spotify sign-in was cancelled.',
  google_denied: 'Google sign-in was cancelled.',
  spotify_token_failed: 'Spotify sign-in could not be completed.',
  google_token_failed: 'Google sign-in could not be completed.',
  spotify_profile_failed: 'Spotify account details could not be loaded.',
  google_profile_failed: 'Google account details could not be loaded.',
  venue_not_found: 'No venue was found for that admin account.',
  spotify_account_in_use: 'That Spotify account is already linked to another venue.',
  google_account_in_use: 'That Google account is already linked to another venue.',
  internal_error: 'Something went wrong while signing you in.',
};

function SignInContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get('error');

  return (
    <main className="min-h-screen bg-gray-950 text-white flex items-center justify-center p-6">
      <div className="max-w-sm w-full space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold">🎛️ Admin Sign In</h1>
          <p className="text-gray-400 text-sm">
            Use the same Spotify or Google authorization you already need for playback.
          </p>
        </div>

        <div className="space-y-3">
          <a
            href="/api/admin/sign-in/spotify"
            className="block w-full rounded-xl bg-green-600 hover:bg-green-500 text-white font-semibold py-3 text-center transition-colors"
          >
            Continue with Spotify
          </a>
          <a
            href="/api/admin/sign-in/google"
            className="block w-full rounded-xl bg-white hover:bg-gray-100 text-gray-950 font-semibold py-3 text-center transition-colors"
          >
            Continue with Google
          </a>
        </div>

        <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4 text-sm text-gray-300">
          Authorizing here signs you in and connects the streaming account in one step. You can
          finish venue setup and change settings later from the dashboard.
        </div>

        {error && (
          <p className="text-red-400 text-sm text-center">
            {errorMessages[error] ?? 'Sign-in failed. Please try again.'}
          </p>
        )}

        <p className="text-center text-sm text-gray-500">
          Need a venue?{' '}
          <Link href="/admin/sign-up" className="text-green-400 hover:text-green-300 transition-colors">
            Start here
          </Link>
         </p>
      </div>
    </main>
  );
}

export default function AdminSignInPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen bg-gray-950 text-white flex items-center justify-center p-6">
        <p className="text-gray-400 animate-pulse">Loading...</p>
      </main>
    }>
      <SignInContent />
    </Suspense>
  );
}
