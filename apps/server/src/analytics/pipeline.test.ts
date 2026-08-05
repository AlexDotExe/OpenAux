import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAnalyticsPipeline,
  type AnalyticsWriter,
  type StoredAnalyticsEvent,
} from './pipeline.js';

function makeLogger() {
  return { error: vi.fn() };
}

const baseEvent = {
  eventType: 'request_created' as const,
  venueId: 'venue-1',
  actorUserId: 'user-1',
  queueItemId: 'item-1',
  metadata: { foo: 'bar' },
};

describe('emitAnalyticsEvent', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('validates eventType against ANALYTICS_EVENT_TYPES and drops unknown types without throwing', () => {
    const writer: AnalyticsWriter = { insertBatch: vi.fn().mockResolvedValue(undefined) };
    const logger = makeLogger();
    const pipeline = createAnalyticsPipeline({ writer, logger, flushIntervalMs: 100_000 });

    expect(() =>
      pipeline.emitAnalyticsEvent({ ...baseEvent, eventType: 'not_a_real_event' as never }),
    ).not.toThrow();

    expect(pipeline.queueSize()).toBe(0);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('unknown event_type'),
      expect.objectContaining({ eventType: 'not_a_real_event' }),
    );
    pipeline.stop();
  });

  it('enqueues a valid event in-memory without writing synchronously', () => {
    const writer: AnalyticsWriter = { insertBatch: vi.fn().mockResolvedValue(undefined) };
    const pipeline = createAnalyticsPipeline({ writer, flushIntervalMs: 100_000 });

    pipeline.emitAnalyticsEvent(baseEvent);

    expect(pipeline.queueSize()).toBe(1);
    expect(writer.insertBatch).not.toHaveBeenCalled();
    pipeline.stop();
  });

  it('fills in eventId and eventTimestamp when the caller omits them', async () => {
    let captured: StoredAnalyticsEvent[] = [];
    const writer: AnalyticsWriter = {
      insertBatch: vi.fn(async (events) => {
        captured = events;
      }),
    };
    const now = new Date('2026-07-24T12:00:00Z');
    const pipeline = createAnalyticsPipeline({
      writer,
      flushIntervalMs: 100_000,
      now: () => now,
      idGenerator: () => 'fixed-id',
    });

    pipeline.emitAnalyticsEvent(baseEvent);
    await pipeline.flush();

    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      eventId: 'fixed-id',
      eventTimestamp: now,
      eventType: 'request_created',
      venueId: 'venue-1',
      actorUserId: 'user-1',
      queueItemId: 'item-1',
      metadataJson: { foo: 'bar' },
    });
  });

  it('never throws into the caller even when the writer always fails', async () => {
    const writer: AnalyticsWriter = {
      insertBatch: vi.fn().mockRejectedValue(new Error('db down')),
    };
    const logger = makeLogger();
    const pipeline = createAnalyticsPipeline({ writer, logger, flushIntervalMs: 100_000 });

    expect(() => pipeline.emitAnalyticsEvent(baseEvent)).not.toThrow();
    await expect(pipeline.flush()).resolves.toBeUndefined();

    pipeline.stop();
  });

  it('retries a failed batch insert exactly once, then drops it and logs', async () => {
    const insertBatch = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockRejectedValueOnce(new Error('again'));
    const writer: AnalyticsWriter = { insertBatch };
    const logger = makeLogger();
    const pipeline = createAnalyticsPipeline({ writer, logger, flushIntervalMs: 100_000 });

    pipeline.emitAnalyticsEvent(baseEvent);
    await pipeline.flush();

    expect(insertBatch).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('failed after retry'),
      expect.objectContaining({ batchSize: 1 }),
    );
    expect(pipeline.queueSize()).toBe(0); // batch dropped, not requeued
    pipeline.stop();
  });

  it('succeeds on the retry attempt without dropping the batch', async () => {
    const insertBatch = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce(undefined);
    const writer: AnalyticsWriter = { insertBatch };
    const logger = makeLogger();
    const pipeline = createAnalyticsPipeline({ writer, logger, flushIntervalMs: 100_000 });

    pipeline.emitAnalyticsEvent(baseEvent);
    await pipeline.flush();

    expect(insertBatch).toHaveBeenCalledTimes(2);
    expect(logger.error).not.toHaveBeenCalled();
    pipeline.stop();
  });

  it('auto-flushes once the queue reaches maxBatchSize', async () => {
    const insertBatch = vi.fn().mockResolvedValue(undefined);
    const writer: AnalyticsWriter = { insertBatch };
    const pipeline = createAnalyticsPipeline({ writer, flushIntervalMs: 100_000, maxBatchSize: 2 });

    pipeline.emitAnalyticsEvent(baseEvent);
    pipeline.emitAnalyticsEvent(baseEvent);
    // flush() is fire-and-forget from emitAnalyticsEvent; give the microtask queue a turn.
    await Promise.resolve();
    await Promise.resolve();

    expect(insertBatch).toHaveBeenCalledTimes(1);
    expect(insertBatch.mock.calls[0]![0]).toHaveLength(2);
    pipeline.stop();
  });

  it('flushes on the background interval', async () => {
    vi.useFakeTimers();
    const insertBatch = vi.fn().mockResolvedValue(undefined);
    const writer: AnalyticsWriter = { insertBatch };
    const pipeline = createAnalyticsPipeline({ writer, flushIntervalMs: 1000 });

    pipeline.emitAnalyticsEvent(baseEvent);
    await vi.advanceTimersByTimeAsync(1000);

    expect(insertBatch).toHaveBeenCalledTimes(1);
    pipeline.stop();
  });
});
