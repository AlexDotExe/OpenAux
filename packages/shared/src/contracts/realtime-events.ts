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

import type { QueueItem, QueueItemId, SessionId } from "../types/domain.js";
import type { QueueSnapshot } from "./api.js";
import type { Track } from "./music-provider.js";

export type RealtimeEvent =
  | QueueUpdatedEvent
  | NowPlayingChangedEvent
  | AnnouncementEvent
  | SessionExpiredEvent
  | PlaybackCommandEvent
  | PowerHourActivatedEvent
  | PowerHourEndedEvent
  | CrowdSkipVoteUpdateEvent
  | SongCrowdSkippedEvent;

/** Queue order or scores changed — clients re-render both lists. */
export interface QueueUpdatedEvent {
  type: "queue_updated";
  payload: QueueSnapshot;
}

export interface NowPlayingChangedEvent {
  type: "now_playing_changed";
  payload: {
    queueItem: QueueItem | null;
    /** Display name of the requester — "DJ Alex is playing…". */
    djAttribution: string | null;
  };
}

export interface AnnouncementEvent {
  type: "announcement";
  payload: {
    kind: "dj_attribution" | "venue_anthem" | "anthem_won" | "venue_message";
    text: string;
    /** Auto-dismiss after this many seconds. */
    ttlSeconds: number;
  };
}

/** Sent to a specific client when its session lapses (1h inactivity). */
export interface SessionExpiredEvent {
  type: "session_expired";
  payload: { sessionId: SessionId };
}

/**
 * Sent ONLY to console-role connections. For Apple Music venues the console
 * executes the command via MusicKit JS and reports resulting state through
 * POST /api/venues/:venueId/playback/state. Spotify venues normally never see
 * these (the server drives Spotify Connect directly).
 */
export interface PlaybackCommandEvent {
  type: "playback_command";
  payload: {
    command: "queue_next" | "play" | "pause" | "skip";
    /** Present for queue_next: the track to load. */
    track: Track | null;
    /** Echo back in the state report so the server can correlate. */
    commandId: string;
  };
}

/** Power Hour Mode activated — clients show the "🔥 Boosted by …" banner (SPEC.md §5 V1). */
export interface PowerHourActivatedEvent {
  type: "power_hour_activated";
  payload: {
    genre: string;
    multiplier: number;
    /** ISO-8601 instant the window ends. */
    endsAt: string;
    /** Optional banner copy, e.g. "🔥 Boosted by 4 Tequila Shots". */
    bannerText: string | null;
  };
}

/** Power Hour window ended — clients dismiss the banner. */
export interface PowerHourEndedEvent {
  type: "power_hour_ended";
  payload: { genre: string };
}

/** Running crowd-skip tally for the now-playing song changed (SPEC.md §5 V1). */
export interface CrowdSkipVoteUpdateEvent {
  type: "crowd_skip_vote_update";
  payload: {
    queueItemId: QueueItemId;
    crowdSkipVotes: number;
    /** Votes needed to skip, so clients can render "3 / 5". */
    threshold: number;
  };
}

/** The now-playing song was skipped by crowd vote — advance UI + announcement. */
export interface SongCrowdSkippedEvent {
  type: "song_crowd_skipped";
  payload: {
    queueItemId: QueueItemId;
    crowdSkipVotes: number;
  };
}
