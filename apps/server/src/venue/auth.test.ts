import { describe, expect, it, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createVenueAdminGuard, extractBearerToken, type AdminTokenProvider } from './auth.js';

describe('extractBearerToken', () => {
  it('extracts the token from a well-formed header', () => {
    expect(extractBearerToken('Bearer abc123')).toBe('abc123');
  });

  it('is case-insensitive on the "Bearer" scheme', () => {
    expect(extractBearerToken('bearer abc123')).toBe('abc123');
  });

  it('returns null for a missing header', () => {
    expect(extractBearerToken(undefined)).toBeNull();
  });

  it('returns null for a malformed header', () => {
    expect(extractBearerToken('Token abc123')).toBeNull();
  });
});

function fakeRequest(
  venueId: string,
  authorization?: string,
): FastifyRequest<{ Params: { venueId: string } }> {
  return {
    params: { venueId },
    headers: { authorization },
  } as unknown as FastifyRequest<{ Params: { venueId: string } }>;
}

function fakeReply(): FastifyReply & { statusCode?: number; body?: unknown } {
  const reply: Partial<FastifyReply> & { statusCode?: number; body?: unknown } = {};
  reply.code = vi.fn().mockImplementation((code: number) => {
    reply.statusCode = code;
    return reply;
  }) as unknown as FastifyReply['code'];
  reply.send = vi.fn().mockImplementation((body: unknown) => {
    reply.body = body;
    return reply;
  }) as unknown as FastifyReply['send'];
  return reply as FastifyReply & { statusCode?: number; body?: unknown };
}

describe('createVenueAdminGuard', () => {
  const provider: AdminTokenProvider = {
    getExpectedToken: vi.fn().mockResolvedValue('secret-token'),
  };

  it('allows a request with the correct bearer token', async () => {
    const guard = createVenueAdminGuard(provider);
    const reply = fakeReply();
    await guard(fakeRequest('venue-1', 'Bearer secret-token'), reply);
    expect(reply.code).not.toHaveBeenCalled();
  });

  it('rejects a request with no authorization header', async () => {
    const guard = createVenueAdminGuard(provider);
    const reply = fakeReply();
    await guard(fakeRequest('venue-1'), reply);
    expect(reply.statusCode).toBe(401);
    expect(reply.body).toMatchObject({ error: { code: 'unauthorized' } });
  });

  it('rejects a request with the wrong token', async () => {
    const guard = createVenueAdminGuard(provider);
    const reply = fakeReply();
    await guard(fakeRequest('venue-1', 'Bearer wrong-token'), reply);
    expect(reply.statusCode).toBe(401);
  });

  it('rejects every request when no token is configured for the venue', async () => {
    const unconfigured: AdminTokenProvider = { getExpectedToken: vi.fn().mockResolvedValue(null) };
    const guard = createVenueAdminGuard(unconfigured);
    const reply = fakeReply();
    await guard(fakeRequest('venue-1', 'Bearer anything'), reply);
    expect(reply.statusCode).toBe(401);
  });
});
