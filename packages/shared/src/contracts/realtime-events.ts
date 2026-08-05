/**
 * WebSocket contract. One channel per venue: /ws/venues/:venueId
 *
 * Every message is JSON: { type, payload }. Server → client only; patron and
 * console actions (including playback-state reports) go through the REST API.
 *
 * Connection roles: patron connections attach `?sessionId=`; the venue console
 * attaches `?role=console` plus its admin token and additionally receives
 * playback_command events (never sent to patrons).
 */

import type { QueueItem, SessionId } from '../types/domain.js';
import type { QueueSnapshot } from './api.js';
import type { Track } from './music-provider.js';

export type RealtimeEvent =
  | QueueUpdatedEvent
  | NowPlayingChangedEvent
  | AnnouncementEvent
  | SessionExpiredEvent
  | PlaybackCommandEvent;

/** Queue order or scores changed — clients re-render both lists. */
export interface QueueUpdatedEvent {
  type: 'queue_updated';
  payload: QueueSnapshot;
}

export interface NowPlayingChangedEvent {
  type: 'now_playing_changed';
  payload: {
    queueItem: QueueItem | null;
    /** Display name of the requester — "DJ Alex is playing…". */
    djAttribution: string | null;
  };
}

export interface AnnouncementEvent {
  type: 'announcement';
  payload: {
    kind: 'dj_attribution' | 'venue_anthem' | 'anthem_won' | 'venue_message';
    text: string;
    /** Auto-dismiss after this many seconds. */
    ttlSeconds: number;
  };
}

/** Sent to a specific client when its session lapses (1h inactivity). */
export interface SessionExpiredEvent {
  type: 'session_expired';
  payload: { sessionId: SessionId };
}

/**
 * Sent ONLY to console-role connections. For Apple Music venues the console
 * executes the command via MusicKit JS and reports resulting state through
 * POST /api/venues/:venueId/playback/state. Spotify venues normally never see
 * these (the server drives Spotify Connect directly).
 */
export interface PlaybackCommandEvent {
  type: 'playback_command';
  payload: {
    command: 'queue_next' | 'play' | 'pause' | 'skip';
    /** Present for queue_next: the track to load. */
    track: Track | null;
    /** Echo back in the state report so the server can correlate. */
    commandId: string;
  };
}
