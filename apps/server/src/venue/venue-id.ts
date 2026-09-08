/**
 * Venue-id shape guard + Postgres `invalid_text_representation` safety net.
 *
 * `venues.venue_id` (and `queue_items.queue_item_id`) are `uuid` columns in
 * db/schema.sql. A malformed id such as `/api/venues/nonexistent` can never
 * match a row, but feeding it straight into SQL makes Postgres raise
 * `invalid input syntax for type uuid` (SQLSTATE 22P02), which surfaced to
 * callers as an HTTP 500 instead of a clean 404 — e.g.
 * GET /api/venues/:venueId -> reconcilePowerHourOnRead -> getPowerHour.
 *
 * Two layers, both mapping to the contract's `not_found` ApiErrorCode so a
 * well-formed-but-unknown uuid and a malformed id are indistinguishable:
 *
 *  1. `venueIdParamGuard` — an onRequest hook rejecting a bad `:venueId`
 *     before any handler (and therefore before any query) runs.
 *  2. `mapUuidSyntaxErrorToNotFound` — a scoped error handler that converts a
 *     22P02 escaping any venue route into 404, covering ids the hook does not
 *     inspect (route params added later, ids taken from bodies, etc.).
 */
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { errorResponse } from './errors.js';

/** SQLSTATE 22P02 — invalid_text_representation (e.g. a non-uuid passed to a uuid column). */
export const PG_INVALID_TEXT_REPRESENTATION = '22P02';

/** Canonical 8-4-4-4-12 hex form, any uuid version, case-insensitive. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when `value` could address a `uuid` column (shape only — says nothing about existence). */
export function isUuidShape(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/** True for a pg error raised because a value could not be parsed as its column type. */
export function isUuidSyntaxError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === PG_INVALID_TEXT_REPRESENTATION
  );
}

/**
 * onRequest hook: 404 `not_found` for a `:venueId` that is not a uuid, so the
 * malformed id never reaches SQL. Routes without a `:venueId` param pass through.
 */
export async function venueIdParamGuard(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { venueId } = request.params as { venueId?: unknown };
  if (venueId !== undefined && !isUuidShape(venueId)) {
    await reply.code(404).send(errorResponse('not_found', 'venue not found'));
  }
}

/**
 * Scoped error handler: a 22P02 that escapes a handler means an unparseable id
 * reached SQL, which can only ever mean "no such row" — answer 404 rather than
 * 500. Everything else is re-thrown to the parent (default) error handler.
 */
export function mapUuidSyntaxErrorToNotFound(
  error: FastifyError,
  _request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (isUuidSyntaxError(error)) {
    void reply.code(404).send(errorResponse('not_found', 'not found'));
    return;
  }
  throw error;
}
