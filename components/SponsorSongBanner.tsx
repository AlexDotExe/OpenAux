'use client';

import { useEffect, useState } from 'react';

interface ActivePromotion {
  id: string;
  promotionText: string | null;
  promotionDurationMinutes: number;
  promotionActivatedAt: string;
  promotionExpiresAt: string;
  isAnthem: boolean;
  song: {
    title: string;
    artist: string;
    albumArtUrl?: string | null;
  };
}

interface SponsorSongBannerProps {
  activePromotion: ActivePromotion | null;
}

export function SponsorSongBanner({ activePromotion }: SponsorSongBannerProps) {
  const [secondsLeft, setSecondsLeft] = useState<number>(0);

  useEffect(() => {
    if (!activePromotion?.promotionExpiresAt) {
      setSecondsLeft(0);
      return;
    }

    const update = () => {
      const expiresAt = new Date(activePromotion.promotionExpiresAt).getTime();
      setSecondsLeft(Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)));
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [activePromotion]);

  if (!activePromotion || secondsLeft <= 0) {
    return null;
  }

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const timeLabel = `${minutes}:${seconds.toString().padStart(2, '0')}`;

  return (
    <div className="bg-amber-900/40 border-2 border-amber-500 rounded-xl p-4 animate-pulse-once">
      <div className="flex items-start gap-3">
        {activePromotion.song.albumArtUrl && (
          <img
            src={activePromotion.song.albumArtUrl}
            alt={`${activePromotion.song.title} album art`}
            className="w-14 h-14 rounded-lg object-cover flex-shrink-0"
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">🍹</span>
            <span className="text-sm font-bold text-amber-300 uppercase tracking-wide">
              {activePromotion.isAnthem ? "Tonight's Anthem Special" : "Sponsor Song Promo"}
            </span>
          </div>
          <p className="text-xs text-amber-200 mb-1 truncate">
            <span className="font-medium">{activePromotion.song.title}</span>
            {' '}by {activePromotion.song.artist}
          </p>
          {activePromotion.promotionText && (
            <p className="text-white font-bold text-base leading-tight">
              {activePromotion.promotionText}
            </p>
          )}
        </div>
        <div className="flex flex-col items-center shrink-0">
          <span className="text-amber-300 font-mono font-bold text-lg">{timeLabel}</span>
          <span className="text-amber-500 text-xs">left</span>
        </div>
      </div>
      <p className="text-amber-400 text-xs mt-2 text-center">
        🎵 Rush to the bar — this deal ends soon!
      </p>
    </div>
  );
}
