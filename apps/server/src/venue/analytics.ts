/**
 * Fire-and-forget analytics writer (spec §1 layer 6: "Analytics writes must
 * never block queue operations"). Writes directly to analytics_events via
 * the shared pool — this workstream only needs 'venue_override_used' and
 * 'song_skipped', both already in ANALYTICS_EVENT_TYPES
 * (packages/shared/src/contracts/analytics-events.ts), so no contract
 * change is needed here.
 */
import type { Pool } from 'pg';
import type { AnalyticsSink } from './types.js';

export class PostgresAnalyticsSink implements AnalyticsSink {
  constructor(private readonly pool: Pool) {}

  record(event: {
    eventType: string;
    venueId: string;
    actorUserId?: string | null;
    queueItemId?: string | null;
    metadata?: Record<string, unknown>;
  }): void {
    // Intentionally not awaited by callers: never block the venue action on analytics I/O.
    void this.pool
      .query(
        `insert into analytics_events (event_type, actor_user_id, venue_id, queue_item_id, metadata_json)
         values ($1, $2, $3, $4, $5::jsonb)`,
        [
          event.eventType,
          event.actorUserId ?? null,
          event.venueId,
          event.queueItemId ?? null,
          JSON.stringify(event.metadata ?? {}),
        ],
      )
      .catch((err: unknown) => {
        console.error('[venue][analytics] failed to record event', event.eventType, err);
      });
  }
}
