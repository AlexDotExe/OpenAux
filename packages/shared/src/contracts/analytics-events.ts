/**
 * Analytics event log contract (spec §1 layer 6).
 *
 * Rules:
 * - Append-only. Writes must never block queue operations.
 * - Every event type below MUST be emitted where it occurs — no silent features.
 */

export const ANALYTICS_EVENT_TYPES = [
  'request_created',
  'vote_added',
  'vote_removed',
  'boost_purchased',
  'song_played',
  'song_skipped',
  'user_session_started',
  'user_session_expired',
  'venue_override_used',
  'promo_code_redeemed',
  'refund_issued',
] as const;

export type AnalyticsEventType = (typeof ANALYTICS_EVENT_TYPES)[number];

export interface AnalyticsEvent {
  eventId: string;
  eventType: AnalyticsEventType;
  eventTimestamp: Date;
  actorUserId: string | null;
  venueId: string;
  queueItemId: string | null;
  metadata: Record<string, unknown>;
}
