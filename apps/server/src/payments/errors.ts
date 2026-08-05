/**
 * Payment-layer error type.
 *
 * All codes settlement raises now live in the shared `ApiErrorCode` union
 * (packages/shared/src/contracts/api.ts) — including `boost_type_unavailable`
 * and `payment_gateway_error`, previously widened locally here.
 */
import type { ApiErrorCode } from '@openaux/shared';

export type PaymentsErrorCode = ApiErrorCode;

/** HTTP status per error code. */
const STATUS_BY_CODE: Record<PaymentsErrorCode, number> = {
  venue_blocked_artist: 400,
  venue_blocked_genre: 400,
  explicit_blocked: 400,
  duplicate_locked: 409,
  max_active_requests: 409,
  request_cooldown: 429,
  session_invalid: 401,
  session_expired: 401,
  insufficient_credits: 402,
  boost_limit_reached: 409,
  validation: 400,
  not_found: 404,
  unauthorized: 401,
  internal: 500,
  boost_type_unavailable: 400,
  payment_gateway_error: 402,
};

/** A typed, throwable error that carries a contract error code + HTTP status. */
export class PaymentsError extends Error {
  readonly code: PaymentsErrorCode;
  readonly statusCode: number;

  constructor(code: PaymentsErrorCode, message: string) {
    super(message);
    this.name = 'PaymentsError';
    this.code = code;
    this.statusCode = STATUS_BY_CODE[code];
  }

  /** Serialize to the contract `ApiError` envelope. */
  toEnvelope(): { error: { code: PaymentsErrorCode; message: string } } {
    return { error: { code: this.code, message: this.message } };
  }
}

export function isPaymentsError(err: unknown): err is PaymentsError {
  return err instanceof PaymentsError;
}
