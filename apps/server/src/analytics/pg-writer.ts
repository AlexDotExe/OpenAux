/**
 * Postgres-backed AnalyticsWriter — batch-inserts into analytics_events
 * (db/schema.sql). The pipeline never awaits this directly on the caller's
 * request path; it's only invoked from the background flush.
 */

import type { AnalyticsWriter, StoredAnalyticsEvent } from './pipeline.js';

/** Minimal shape we need from `pg`'s Pool — keeps this file test-stubbable. */
export interface AnalyticsWriterPool {
  query(text: string, params?: unknown[]): Promise<unknown>;
}

const COLUMNS_PER_ROW = 7;

export function createPgAnalyticsWriter(pool: AnalyticsWriterPool): AnalyticsWriter {
  return {
    async insertBatch(events: StoredAnalyticsEvent[]): Promise<void> {
      if (events.length === 0) return;

      const values: unknown[] = [];
      const placeholders = events.map((event, rowIndex) => {
        const base = rowIndex * COLUMNS_PER_ROW;
        values.push(
          event.eventId,
          event.eventType,
          event.eventTimestamp,
          event.actorUserId,
          event.venueId,
          event.queueItemId,
          JSON.stringify(event.metadataJson),
        );
        const params = Array.from(
          { length: COLUMNS_PER_ROW },
          (_, colIndex) => `$${base + colIndex + 1}`,
        );
        return `(${params.join(', ')})`;
      });

      const sql = `
        insert into analytics_events
          (event_id, event_type, event_timestamp, actor_user_id, venue_id, queue_item_id, metadata_json)
        values ${placeholders.join(', ')}
      `;

      await pool.query(sql, values);
    },
  };
}
