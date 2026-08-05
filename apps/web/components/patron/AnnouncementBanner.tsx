'use client';

/**
 * Renders the announcement stream from useVenueChannel: dj_attribution,
 * venue_anthem, anthem_won, venue_message. Auto-dismisses each banner after
 * its ttlSeconds.
 */

import { useEffect } from 'react';

import type { AnnouncementItem } from '../../lib/realtimeReducer';

export interface AnnouncementBannerProps {
  announcements: AnnouncementItem[];
  onDismiss: (id: string) => void;
}

export function AnnouncementBanner({ announcements, onDismiss }: AnnouncementBannerProps) {
  if (announcements.length === 0) return null;
  return (
    <div className="stack" role="status" aria-live="polite">
      {announcements.map((a) => (
        <AnnouncementItemView key={a.id} announcement={a} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function AnnouncementItemView({
  announcement,
  onDismiss,
}: {
  announcement: AnnouncementItem;
  onDismiss: (id: string) => void;
}) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(announcement.id), announcement.ttlSeconds * 1000);
    return () => clearTimeout(timer);
  }, [announcement.id, announcement.ttlSeconds, onDismiss]);

  return (
    <div className={`banner banner--${announcement.kind}`}>
      {announcement.kind === 'venue_anthem' && '🎉 '}
      {announcement.kind === 'anthem_won' && '🥂 '}
      {announcement.kind === 'dj_attribution' && '🎧 '}
      {announcement.text}
      <button
        onClick={() => onDismiss(announcement.id)}
        aria-label="Dismiss"
        style={{ background: 'none', border: 'none', float: 'right', color: 'inherit' }}
      >
        ×
      </button>
    </div>
  );
}
