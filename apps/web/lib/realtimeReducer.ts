/**
 * Pure reducer over RealtimeEvent (packages/shared/src/contracts/realtime-events.ts).
 * Kept separate from useVenueChannel.ts so it's unit-testable without a
 * WebSocket or DOM — see lib/realtimeReducer.test.ts.
 */

import type {
  AnnouncementEvent,
  CrowdSkipVoteUpdateEvent,
  NowPlayingChangedEvent,
  PowerHourActivatedEvent,
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
  /** Active Power Hour window (SPEC.md §5 V1), or null when none is running. */
  powerHour: PowerHourActivatedEvent['payload'] | null;
  /** Running crowd-skip tally for the now-playing song, or null before any vote. */
  crowdSkip: CrowdSkipVoteUpdateEvent['payload'] | null;
}

export const initialVenueChannelState: VenueChannelState = {
  queue: null,
  nowPlaying: null,
  announcements: [],
  sessionExpired: false,
  powerHour: null,
  crowdSkip: null,
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
      // A new song is playing — reset any crowd-skip tally from the previous one.
      return { ...state, nowPlaying: action.payload, crowdSkip: null };
    case 'power_hour_activated':
      return { ...state, powerHour: action.payload };
    case 'power_hour_ended':
      return { ...state, powerHour: null };
    case 'crowd_skip_vote_update':
      return { ...state, crowdSkip: action.payload };
    case 'song_crowd_skipped':
      // The advance itself arrives via now_playing_changed; just clear the tally.
      return { ...state, crowdSkip: null };
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
