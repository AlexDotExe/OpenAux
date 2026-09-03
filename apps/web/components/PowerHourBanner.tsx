'use client';

/**
 * Shared "🔥 Power Hour" banner with a live countdown (SPEC.md §5/§6 shared
 * displays). Driven by the active Power Hour window — patron and venue console
 * both render it. Returns null when there is no active window or it has ended.
 */

import { useEffect, useState } from 'react';

export interface PowerHourBannerProps {
  genre: string;
  multiplier: number;
  /** ISO-8601 instant the window ends. */
  endsAt: string;
  /** Optional pre-composed copy, e.g. "🔥 Boosted by 4 Tequila Shots". */
  bannerText?: string | null;
}

function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function PowerHourBanner({ genre, multiplier, endsAt, bannerText }: PowerHourBannerProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const remaining = Date.parse(endsAt) - now;
  if (Number.isNaN(remaining) || remaining <= 0) return null;

  return (
    <div className="banner banner--anthem_won">
      <strong>{bannerText ?? `🔥 Power Hour — ${genre} ×${multiplier}`}</strong>{' '}
      <span>
        {genre} songs count ×{multiplier} for {formatRemaining(remaining)}
      </span>
    </div>
  );
}
