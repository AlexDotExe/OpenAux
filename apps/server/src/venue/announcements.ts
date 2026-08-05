/**
 * Announcement text + emission for the two SPEC.md §5 "Announcements" items
 * this workstream owns: dj_attribution ("DJ <name> is playing…") and venue
 * anthem announcements (both the "here's tonight's anthem" call-out and the
 * "the anthem just won" celebration). Emission goes through the injectable
 * Broadcaster so this module never imports apps/server/src/realtime/.
 */
import type { AnnouncementEvent, QueueItem, QueueItemSourceType } from '@openaux/shared';
import { isAnthemWin } from './anthem-logic.js';
import type { AnthemConfig, Broadcaster, VenueRepository } from './types.js';

export function buildDjAttributionText(
  item: { title: string; artist: string; sourceType: QueueItemSourceType },
  requesterDisplayName: string,
): string {
  if (item.sourceType === 'venue' || item.sourceType === 'override') {
    return `The venue is now playing "${item.title}" by ${item.artist}`;
  }
  return `DJ ${requesterDisplayName} is playing "${item.title}" by ${item.artist}`;
}

export function buildVenueAnthemAnnouncementText(
  anthem: Pick<AnthemConfig, 'title' | 'artist' | 'promoText'>,
): string {
  return `Tonight's anthem: "${anthem.title}" by ${anthem.artist} — get it played and unlock: ${anthem.promoText}`;
}

export function buildAnthemWonText(promoText: string): string {
  return `The anthem just played! ${promoText}`;
}

export function emitAnnouncement(
  broadcaster: Broadcaster,
  venueId: string,
  kind: AnnouncementEvent['payload']['kind'],
  text: string,
  ttlSeconds: number,
): void {
  broadcaster.broadcastToVenue(venueId, {
    type: 'announcement',
    payload: { kind, text, ttlSeconds },
  });
}

const DJ_ATTRIBUTION_TTL_SECONDS = 15;

export interface AnnouncementsService {
  /**
   * Hook the queue engine (WS3) calls whenever a queue_items row transitions
   * to status = 'playing'. Always emits a dj_attribution announcement; if
   * the item is the venue's configured anthem, also emits anthem_won.
   */
  notifyNowPlaying(queueItem: QueueItem): Promise<void>;
}

export function createAnnouncementsService(deps: {
  repository: Pick<VenueRepository, 'getAnthem' | 'getUserDisplayName'>;
  broadcaster: Broadcaster;
}): AnnouncementsService {
  return {
    async notifyNowPlaying(queueItem: QueueItem): Promise<void> {
      const displayName =
        (await deps.repository.getUserDisplayName(queueItem.requestingUserId)) ?? 'a guest';
      const djText = buildDjAttributionText(queueItem, displayName);
      emitAnnouncement(
        deps.broadcaster,
        queueItem.venueId,
        'dj_attribution',
        djText,
        DJ_ATTRIBUTION_TTL_SECONDS,
      );

      const anthem = await deps.repository.getAnthem(queueItem.venueId);
      if (
        anthem &&
        isAnthemWin({ provider: queueItem.provider, songId: queueItem.songId }, anthem)
      ) {
        const wonText = buildAnthemWonText(anthem.promoText);
        emitAnnouncement(
          deps.broadcaster,
          queueItem.venueId,
          'anthem_won',
          wonText,
          anthem.promoDurationMinutes * 60,
        );
      }
    },
  };
}
