/**
 * Pure reducer over RealtimeEvent (packages/shared/src/contracts/realtime-events.ts).
 * Kept separate from useVenueChannel.ts so it's unit-testable without a
 * WebSocket or DOM — see lib/realtimeReducer.test.ts.
 */

import type {
  AnnouncementEvent,
  NowPlayingChangedEvent,
  QueueItem,
  QueueSnapshot,
  RealtimeEvent,
} from '@openaux/shared';

export interface AnnouncementItem {
  id: string;
  kind: AnnouncementEvent['payload']['kind'];
  text: string;
  ttlSeconds: number;
}

export interface VenueChannelState {
  queue: QueueSnapshot | null;
  nowPlaying: NowPlayingChangedEvent['payload'] | null;
  announcements: AnnouncementItem[];
  sessionExpired: boolean;
}

export const initialVenueChannelState: VenueChannelState = {
  queue: null,
  nowPlaying: null,
  announcements: [],
  sessionExpired: false,
};

export type VenueChannelAction = RealtimeEvent | { type: 'dismiss_announcement'; id: string };

let announcementSeq = 0;
function nextAnnouncementId(): string {
  announcementSeq += 1;
  return `announcement-${announcementSeq}-${Date.now()}`;
}

export function applyRealtimeEvent(
  state: VenueChannelState,
  action: VenueChannelAction,
): VenueChannelState {
  switch (action.type) {
    case 'queue_updated':
      return { ...state, queue: action.payload };
    case 'now_playing_changed':
      return { ...state, nowPlaying: action.payload };
    case 'announcement':
      return {
        ...state,
        announcements: [
          ...state.announcements,
          {
            id: nextAnnouncementId(),
            kind: action.payload.kind,
            text: action.payload.text,
            ttlSeconds: action.payload.ttlSeconds,
          },
        ],
      };
    case 'session_expired':
      return { ...state, sessionExpired: true };
    case 'dismiss_announcement':
      return {
        ...state,
        announcements: state.announcements.filter((a) => a.id !== action.id),
      };
    default:
      return state;
  }
}

/** Re-exported for consumers that only need the "is this a queue item" narrowing. */
export type { QueueItem };
