/**
 * PROVISIONAL console auth for the playback-state REST route. The venue console
 * authenticates its POST /api/venues/:venueId/playback/state calls with the same
 * shared secret it used to open its console WebSocket (VENUE_ADMIN_TOKEN) — see
 * venue/auth.ts for the identical provisional scheme. Self-contained here rather
 * than imported from venue/ (a different workstream's folder).
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiError, ApiErrorCode, VenueId } from '@openaux/shared';

export interface ConsoleTokenProvider {
  /** Expected console token for this venue, or null if none is configured. */
  getExpectedToken(venueId: VenueId): Promise<string | null>;
}

/** Default: one shared secret for every venue, read from env (mirrors venue/auth.ts). */
export class EnvConsoleTokenProvider implements ConsoleTokenProvider {
  constructor(private readonly envVar: string = 'VENUE_ADMIN_TOKEN') {}

  async getExpectedToken(_venueId: VenueId): Promise<string | null> {
    return process.env[this.envVar] ?? null;
  }
}

export function extractBearerToken(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return null;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match ? match[1]!.trim() : null;
}

function timingSafeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function errorResponse(code: ApiErrorCode, message: string): ApiError {
  return { error: { code, message } };
}

/** Builds a Fastify preHandler that rejects playback-state calls without a valid console token. */
export function createConsoleGuard(tokenProvider: ConsoleTokenProvider) {
  return async function consoleGuard(
    request: FastifyRequest<{ Params: { venueId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const expected = await tokenProvider.getExpectedToken(request.params.venueId);
    const provided = extractBearerToken(request.headers.authorization);
    if (!expected || !provided || !timingSafeEquals(provided, expected)) {
      await reply.code(401).send(errorResponse('unauthorized', 'venue console token required'));
    }
  };
}
