import type { ApiError, ApiErrorCode } from '@openaux/shared';

/**
 * Body/param validation failures on venue admin routes use the shared
 * `validation` ApiErrorCode (packages/shared/src/contracts/api.ts). `internal`
 * is reserved for genuine server faults (e.g. an unwired dependency).
 */
export function errorResponse(code: ApiErrorCode, message: string): ApiError {
  return { error: { code, message } };
}
