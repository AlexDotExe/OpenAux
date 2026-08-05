/**
 * analytics — see ownership map in CLAUDE.md before editing (WS6).
 *
 * Exports for other workstreams:
 *   - `emitAnalyticsEvent(event)` — fire-and-forget; never blocks or throws.
 *   - Aggregate query functions in `queries.ts` (log-only, no UI in V0).
 *
 * `emitAnalyticsEvent` here is bound to a lazily-created default pipeline
 * wired to the shared pg pool from `../db.js`. The pipeline (and its interval
 * flush timer) is only created on first use, so importing this module has no
 * side effects — safe for unit tests elsewhere in the server that transitively
 * import it (e.g. antispam's sweeper).
 */

import { pool } from '../db.js';
import {
  createAnalyticsPipeline,
  type AnalyticsPipeline,
  type EmitAnalyticsEventInput,
} from './pipeline.js';
import { createPgAnalyticsWriter } from './pg-writer.js';

export * from './pipeline.js';
export * from './pg-writer.js';
export * from './queries.js';

let defaultPipeline: AnalyticsPipeline | null = null;

function getDefaultPipeline(): AnalyticsPipeline {
  defaultPipeline ??= createAnalyticsPipeline({ writer: createPgAnalyticsWriter(pool) });
  return defaultPipeline;
}

/**
 * Validates event.eventType against ANALYTICS_EVENT_TYPES, enqueues in-memory,
 * and batch-inserts into analytics_events on a background interval. Never
 * blocks or throws into the caller — failures are logged, batch insert is
 * retried once, then dropped.
 */
export function emitAnalyticsEvent(event: EmitAnalyticsEventInput): void {
  getDefaultPipeline().emitAnalyticsEvent(event);
}

/** For graceful shutdown / test cleanup — stops the default pipeline's timer. */
export function stopDefaultAnalyticsPipeline(): void {
  defaultPipeline?.stop();
  defaultPipeline = null;
}
