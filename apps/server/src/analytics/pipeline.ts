/**
 * Async analytics event pipeline (SPEC.md §1 layer 6 / §7 NFR):
 * "Analytics writes must never block queue operations."
 *
 * `emitAnalyticsEvent` is synchronous from the caller's point of view: it
 * validates the event type, pushes onto an in-memory queue, and returns.
 * Actual persistence happens out-of-band (interval flush + batch-size flush),
 * with a single retry on failure; if that also fails the batch is dropped and
 * logged. Nothing in this module ever throws into the caller.
 */

import { randomUUID } from 'node:crypto';
import { ANALYTICS_EVENT_TYPES, type AnalyticsEventType } from '@openaux/shared';

/** What callers pass to `emitAnalyticsEvent` — id/timestamp are filled in if omitted. */
export interface EmitAnalyticsEventInput {
  eventType: AnalyticsEventType;
  actorUserId?: string | null;
  venueId: string;
  queueItemId?: string | null;
  metadata?: Record<string, unknown>;
  eventTimestamp?: Date;
}

/** Fully-resolved row shape, ready to persist to analytics_events. */
export interface StoredAnalyticsEvent {
  eventId: string;
  eventType: AnalyticsEventType;
  eventTimestamp: Date;
  actorUserId: string | null;
  venueId: string;
  queueItemId: string | null;
  metadataJson: Record<string, unknown>;
}

export interface AnalyticsWriter {
  insertBatch(events: StoredAnalyticsEvent[]): Promise<void>;
}

export interface AnalyticsLogger {
  error(message: string, meta?: unknown): void;
}

export interface AnalyticsPipelineDeps {
  writer: AnalyticsWriter;
  /** Defaults to `console`. */
  logger?: AnalyticsLogger;
  /** How often the background flush runs. Default 2000ms. */
  flushIntervalMs?: number;
  /** Queue length that triggers an immediate (non-blocking) flush. Default 25. */
  maxBatchSize?: number;
  now?: () => Date;
  idGenerator?: () => string;
}

export interface AnalyticsPipeline {
  emitAnalyticsEvent(event: EmitAnalyticsEventInput): void;
  /** Flush the current queue now. Exposed for tests/shutdown; never throws. */
  flush(): Promise<void>;
  stop(): void;
  /** Current in-memory queue depth — for tests/observability. */
  queueSize(): number;
}

const DEFAULT_FLUSH_INTERVAL_MS = 2000;
const DEFAULT_MAX_BATCH_SIZE = 25;

const VALID_EVENT_TYPES = new Set<string>(ANALYTICS_EVENT_TYPES);

export function createAnalyticsPipeline(deps: AnalyticsPipelineDeps): AnalyticsPipeline {
  const logger = deps.logger ?? console;
  const now = deps.now ?? (() => new Date());
  const idGenerator = deps.idGenerator ?? randomUUID;
  const maxBatchSize = deps.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE;
  const flushIntervalMs = deps.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;

  const queue: StoredAnalyticsEvent[] = [];
  let flushing = false;

  async function flush(): Promise<void> {
    if (flushing || queue.length === 0) return;
    flushing = true;
    const batch = queue.splice(0, queue.length);
    try {
      await insertWithOneRetry(batch);
    } finally {
      flushing = false;
    }
  }

  async function insertWithOneRetry(batch: StoredAnalyticsEvent[]): Promise<void> {
    try {
      await deps.writer.insertBatch(batch);
    } catch {
      // Swallow + retry once (never block/throw into callers).
      try {
        await deps.writer.insertBatch(batch);
      } catch (retryError) {
        logger.error('analytics pipeline: batch insert failed after retry, dropping batch', {
          error: retryError,
          batchSize: batch.length,
        });
      }
    }
  }

  const timer = setInterval(() => {
    flush().catch((error) => logger.error('analytics pipeline: flush threw unexpectedly', error));
  }, flushIntervalMs);
  timer.unref?.();

  function emitAnalyticsEvent(event: EmitAnalyticsEventInput): void {
    try {
      if (!VALID_EVENT_TYPES.has(event.eventType)) {
        logger.error('analytics pipeline: dropped event with unknown event_type', {
          eventType: event.eventType,
        });
        return;
      }

      queue.push({
        eventId: idGenerator(),
        eventType: event.eventType,
        eventTimestamp: event.eventTimestamp ?? now(),
        actorUserId: event.actorUserId ?? null,
        venueId: event.venueId,
        queueItemId: event.queueItemId ?? null,
        metadataJson: event.metadata ?? {},
      });

      if (queue.length >= maxBatchSize) {
        flush().catch((error) =>
          logger.error('analytics pipeline: flush threw unexpectedly', error),
        );
      }
    } catch (error) {
      // Absolute guarantee: emitAnalyticsEvent must never throw into the caller.
      logger.error('analytics pipeline: unexpected error while enqueueing event', error);
    }
  }

  return {
    emitAnalyticsEvent,
    flush,
    stop: () => clearInterval(timer),
    queueSize: () => queue.length,
  };
}
