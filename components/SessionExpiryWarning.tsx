'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface SessionExpiryWarningProps {
  expiresAt: string | null;
  isExpired: boolean;
}

const WARNING_THRESHOLD_MS = 5 * 60 * 1000; // Warn 5 minutes before expiry

/**
 * Shows a warning banner when the session is about to expire,
 * and a full-screen overlay when it has already expired.
 */
export function SessionExpiryWarning({ expiresAt, isExpired }: SessionExpiryWarningProps) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!expiresAt || isExpired) {
      setSecondsLeft(null);
      return;
    }

    const update = () => {
      const ms = new Date(expiresAt).getTime() - Date.now();
      setSecondsLeft(Math.max(0, Math.floor(ms / 1000)));
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [expiresAt, isExpired]);

  if (isExpired) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-gray-950/95 p-6 text-center">
        <div className="max-w-sm space-y-4">
          <div className="text-5xl">⏱️</div>
          <h2 className="text-2xl font-bold text-white">Session Expired</h2>
          <p className="text-gray-400">
            Your session has expired due to inactivity. Scan the QR code again to rejoin the session.
          </p>
          <Link
            href="/"
            className="block w-full rounded-lg bg-green-500 px-6 py-3 text-center font-semibold text-black hover:bg-green-400 transition-colors"
          >
            Scan QR Code
          </Link>
        </div>
      </div>
    );
  }

  if (secondsLeft === null) return null;

  const msLeft = secondsLeft * 1000;
  if (msLeft > WARNING_THRESHOLD_MS) return null;

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const timeLabel =
    minutes > 0
      ? `${minutes}m ${seconds.toString().padStart(2, '0')}s`
      : `${seconds}s`;

  return (
    <div className="sticky top-14 z-40 bg-yellow-500/10 border border-yellow-500/30 mx-4 mt-2 rounded-lg p-3 flex items-center gap-3">
      <span className="text-yellow-400 text-lg">⚠️</span>
      <p className="text-sm text-yellow-300">
        Session expires in <span className="font-bold">{timeLabel}</span>. Vote or request a song to stay active.
      </p>
    </div>
  );
}
