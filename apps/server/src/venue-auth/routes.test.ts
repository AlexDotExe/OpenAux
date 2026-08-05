/**
 * End-to-end HTTP test of the venue-owner flow through the real Fastify plugin
 * (no database — the in-memory repository stands in for Postgres). Proves the
 * full path a user drives: signup → token → create venue → list venues, plus
 * that the owner token authorizes the venue's admin routes and a stranger's does not.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createVenueAdminVerifier } from './verifier.js';
import { registerVenueAuthRoutes } from './routes.js';
import { InMemoryVenueAuthRepository } from './test-support/memory-repository.js';

function buildApp(): FastifyInstance {
  const app = Fastify();
  const repository = new InMemoryVenueAuthRepository();
  const verifier = createVenueAdminVerifier({ repository, legacySecret: () => null });

  app.register(registerVenueAuthRoutes, { repository, verifier });

  // A stand-in venue-admin route guarded exactly like the real venue console routes.
  app.get<{ Params: { venueId: string } }>(
    '/api/venues/:venueId/protected',
    {
      preHandler: async (request, reply) => {
        const header = request.headers.authorization;
        const token = /^Bearer\s+(.+)$/i.exec(String(header ?? ''))?.[1] ?? null;
        if (!(await verifier.verifyVenueAdmin(request.params.venueId, token))) {
          await reply.code(401).send({ error: { code: 'unauthorized', message: 'no' } });
        }
      },
    },
    async () => ({ ok: true }),
  );

  return app;
}

let app: FastifyInstance;
beforeEach(() => {
  app = buildApp();
});
afterEach(async () => {
  await app.close();
});

async function signup(email: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/venue-owners/signup',
    payload: { email, password: 'password123', displayName: 'Owner' },
  });
  return res;
}

describe('venue-owner HTTP flow', () => {
  it('signs up, returns a token, and reflects it in /me', async () => {
    const res = await signup('owner@bar.com');
    expect(res.statusCode).toBe(201);
    const { token, owner } = res.json();
    expect(token).toBeTruthy();
    expect(owner.email).toBe('owner@bar.com');

    const me = await app.inject({
      method: 'GET',
      url: '/api/venue-owners/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().venues).toEqual([]);
  });

  it('rejects /me and venue creation without a token', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/venue-owners/me' })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/venues',
          payload: { name: 'X', musicProvider: 'spotify' },
        })
      ).statusCode,
    ).toBe(401);
  });

  it('creates a venue and lists it under the owner', async () => {
    const token = (await signup('c@bar.com')).json().token;
    const created = await app.inject({
      method: 'POST',
      url: '/api/venues',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Neon Room', musicProvider: 'spotify' },
    });
    expect(created.statusCode).toBe(201);
    const { venue } = created.json();
    expect(venue.name).toBe('Neon Room');
    expect(venue.qrToken).toBeTruthy();

    const me = await app.inject({
      method: 'GET',
      url: '/api/venue-owners/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.json().venues.map((v: { name: string }) => v.name)).toEqual(['Neon Room']);
  });

  it('authorizes the owner on their venue and rejects a different owner', async () => {
    const ownerToken = (await signup('a@bar.com')).json().token;
    const strangerToken = (await signup('b@bar.com')).json().token;
    const venueId = (
      await app.inject({
        method: 'POST',
        url: '/api/venues',
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { name: 'A', musicProvider: 'spotify' },
      })
    ).json().venue.venueId;

    const asOwner = await app.inject({
      method: 'GET',
      url: `/api/venues/${venueId}/protected`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(asOwner.statusCode).toBe(200);

    const asStranger = await app.inject({
      method: 'GET',
      url: `/api/venues/${venueId}/protected`,
      headers: { authorization: `Bearer ${strangerToken}` },
    });
    expect(asStranger.statusCode).toBe(401);

    const anon = await app.inject({ method: 'GET', url: `/api/venues/${venueId}/protected` });
    expect(anon.statusCode).toBe(401);
  });

  it('rejects duplicate email signups', async () => {
    expect((await signup('dup@bar.com')).statusCode).toBe(201);
    const dup = await signup('dup@bar.com');
    expect(dup.statusCode).toBe(400);
    expect(dup.json().error.code).toBe('validation');
  });
});
