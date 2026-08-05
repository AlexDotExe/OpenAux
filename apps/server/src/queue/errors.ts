/**
 * Typed queue errors. Handlers translate `code` into the ApiError contract shape.
 */

import type { ApiErrorCode } from '@openaux/shared';

export class QueueError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'QueueError';
  }
}

/** HTTP status for each ApiErrorCode. */
export function statusForCode(code: ApiErrorCode): number {
  switch (code) {
    case 'unauthorized':
    case 'session_invalid':
    case 'session_expired':
      return 401;
    case 'not_found':
      return 404;
    case 'venue_blocked_artist':
    case 'venue_blocked_genre':
    case 'explicit_blocked':
    case 'duplicate_locked':
    case 'max_active_requests':
    case 'request_cooldown':
    case 'boost_limit_reached':
    case 'insufficient_credits':
      return 409;
    case 'internal':
      return 500;
    default:
      return 400;
  }
}
