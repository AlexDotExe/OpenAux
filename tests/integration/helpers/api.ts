/**
 * Thin HTTP helpers for the integration suite.
 *
 * Auth transport is deliberately explicit here because the API is not uniform
 * yet (tracked in issue #85): patron queue endpoints take `X-Session-Id`, while
 * payment endpoints take `X-User-Id` (+ `X-Venue-Id` on credit purchase).
 */
import { randomUUID } from 'node:crypto';

export interface ApiCtx {
  baseUrl: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    readonly body: unknown,
  ) {
    super(`HTTP ${status}${code ? ` (${code})` : ''}: ${JSON.stringify(body)}`);
  }
}

async function request<T>(
  ctx: ApiCtx,
  method: string,
  path: string,
  opts: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const init: RequestInit = { method, headers: { ...(opts.headers ?? {}) } };
  if (opts.body !== undefined) {
    init.headers = { ...init.headers, 'Content-Type': 'application/json' };
    init.body = JSON.stringify(opts.body);
  }
  const res = await fetch(`${ctx.baseUrl}${path}`, init);
  const text = await res.text();
  const parsed: unknown = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const code = (parsed as { error?: { code?: string } } | null)?.error?.code;
    throw new ApiError(res.status, code, parsed);
  }
  return parsed as T;
}

export const api = {
  get: <T>(ctx: ApiCtx, path: string, headers?: Record<string, string>) =>
    request<T>(ctx, 'GET', path, { headers }),
  post: <T>(ctx: ApiCtx, path: string, body?: unknown, headers?: Record<string, string>) =>
    request<T>(ctx, 'POST', path, { body, headers }),
  put: <T>(ctx: ApiCtx, path: string, body?: unknown, headers?: Record<string, string>) =>
    request<T>(ctx, 'PUT', path, { body, headers }),
};

/** Patron queue endpoints. */
export const asSession = (sessionId: string) => ({ 'X-Session-Id': sessionId });
/** Payment endpoints (see issue #85 — transport differs from the rest of the API). */
export const asUser = (userId: string, venueId?: string) => ({
  'X-User-Id': userId,
  ...(venueId ? { 'X-Venue-Id': venueId } : {}),
});
/** Venue-admin / console endpoints. */
export const asAdmin = (token: string) => ({ Authorization: `Bearer ${token}` });
/** Every paid action is idempotent; give each call a fresh key. */
export const idempotent = () => ({ 'Idempotency-Key': randomUUID() });

/** Catalog ids served by the deterministic fake provider (MUSIC_PROVIDER_FAKE=1). */
export const FAKE_TRACKS = [
  'fake-track-001',
  'fake-track-002',
  'fake-track-003',
  'fake-track-004',
] as const;
