/**
 * AnalyticsSink — settlement's fire-and-forget seam into the analytics log
 * (SPEC.md §1 layer 6). WS6 owns the real async pipeline in
 * `apps/server/src/analytics/`; until it lands, `PgAnalyticsSink` appends
 * directly to the `analytics_events` table.
 *
 * Contract rule: analytics writes MUST NEVER block or fail a settlement
 * operation — every emit here is best-effort and swallows its own errors.
 */
import type { AnalyticsEventType } from '@openaux/shared';
import type { PgLike } from './repo.js';

export interface AnalyticsEmit {
  eventType: AnalyticsEventType;
  actorUserId: string | null;
  venueId: string;
  queueItemId: string | null;
  metadata?: Record<string, unknown>;
}

export interface AnalyticsSink {
  emit(event: AnalyticsEmit): void;
}

/** Default sink: append to analytics_events; log-and-drop on failure. */
export class PgAnalyticsSink implements AnalyticsSink {
  constructor(
    private readonly db: PgLike,
    private readonly onError: (err: unknown) => void = () => {},
  ) {}

  emit(event: AnalyticsEmit): void {
    // Intentionally not awaited: analytics must never block settlement.
    this.db
      .query(
        `insert into analytics_events
           (event_type, actor_user_id, venue_id, queue_item_id, metadata_json)
         values ($1, $2, $3, $4, $5)`,
        [
          event.eventType,
          event.actorUserId,
          event.venueId,
          event.queueItemId,
          JSON.stringify(event.metadata ?? {}),
        ],
      )
      .catch(this.onError);
  }
}

/** Test/no-op sink that records emitted events. */
export class RecordingAnalyticsSink implements AnalyticsSink {
  readonly events: AnalyticsEmit[] = [];
  emit(event: AnalyticsEmit): void {
    this.events.push(event);
  }
}
