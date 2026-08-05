import { describe, expect, it, vi } from 'vitest';
import { createPgAnalyticsWriter, type AnalyticsWriterPool } from './pg-writer.js';
import type { StoredAnalyticsEvent } from './pipeline.js';

const event = (overrides: Partial<StoredAnalyticsEvent> = {}): StoredAnalyticsEvent => ({
  eventId: 'id-1',
  eventType: 'request_created',
  eventTimestamp: new Date('2026-07-24T12:00:00Z'),
  actorUserId: 'user-1',
  venueId: 'venue-1',
  queueItemId: 'item-1',
  metadataJson: { foo: 'bar' },
  ...overrides,
});

describe('createPgAnalyticsWriter', () => {
  it('does nothing for an empty batch', async () => {
    const pool: AnalyticsWriterPool = { query: vi.fn() };
    const writer = createPgAnalyticsWriter(pool);

    await writer.insertBatch([]);

    expect(pool.query).not.toHaveBeenCalled();
  });

  it('builds a single multi-row insert with one placeholder group per event', async () => {
    const pool: AnalyticsWriterPool = { query: vi.fn().mockResolvedValue(undefined) };
    const writer = createPgAnalyticsWriter(pool);

    await writer.insertBatch([event(), event({ eventId: 'id-2' })]);

    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      unknown[],
    ];

    expect(sql).toContain('insert into analytics_events');
    expect(sql).toContain(
      '(event_id, event_type, event_timestamp, actor_user_id, venue_id, queue_item_id, metadata_json)',
    );
    expect(sql).toContain('($1, $2, $3, $4, $5, $6, $7)');
    expect(sql).toContain('($8, $9, $10, $11, $12, $13, $14)');
    expect(params).toHaveLength(14);
    expect(params[0]).toBe('id-1');
    expect(params[6]).toBe(JSON.stringify({ foo: 'bar' }));
    expect(params[7]).toBe('id-2');
  });
});
