/**
 * Actor-resolution tests: the payment endpoints must speak the same patron auth
 * transport as the rest of the API (`X-Session-Id`) while still accepting the
 * legacy `x-user-id` / `x-venue-id` headers.
 */
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createActorResolver, headerActorResolver, sessionActorResolver } from './auth.js';
import { InMemoryPaymentsRepo, InMemorySessionActorRepo } from './memory-repo.js';
import { FakeGateway } from './gateway.js';
import { RecordingAnalyticsSink } from './analytics.js';
import { PaymentsService } from './service.js';
import { registerPaymentRoutes } from './index.js';
import { isPaymentsError } from './errors.js';

const SESSION_ID = '11111111-2222-4333-8444-555555555555';

/** Minimal FastifyRequest stand-in — the resolvers only read `headers`. */
function reqWith(headers: Record<string, string>): FastifyRequest {
  return { headers } as unknown as FastifyRequest;
}

function sessions(): InMemorySessionActorRepo {
  const repo = new InMemorySessionActorRepo();
  repo.seedSession(SESSION_ID, { userId: 'u1', venueId: 'v1' });
  return repo;
}

/** Assert a rejection carries the given contract error code. */
async function expectUnauthorized(p: Promise<unknown>): Promise<void> {
  await expect(p).rejects.toSatisfy(
    (err: unknown) => isPaymentsError(err) && err.code === 'unauthorized',
  );
}

describe('createActorResolver', () => {
  it('resolves the actor and venue context from X-Session-Id', async () => {
    const resolve = createActorResolver(sessions());
    await expect(resolve(reqWith({ 'x-session-id': SESSION_ID }))).resolves.toEqual({
      userId: 'u1',
      venueId: 'v1',
    });
  });

  it('still resolves via the legacy x-user-id / x-venue-id headers', async () => {
    const resolve = createActorResolver(sessions());
    await expect(
      resolve(reqWith({ 'x-user-id': 'legacy-user', 'x-venue-id': 'legacy-venue' })),
    ).resolves.toEqual({ userId: 'legacy-user', venueId: 'legacy-venue' });
  });

  it('keeps a null venue context when the legacy x-venue-id header is absent', async () => {
    const resolve = createActorResolver(sessions());
    await expect(resolve(reqWith({ 'x-user-id': 'legacy-user' }))).resolves.toEqual({
      userId: 'legacy-user',
      venueId: null,
    });
  });

  it('prefers the session when both transports are present', async () => {
    const resolve = createActorResolver(sessions());
    await expect(
      resolve(reqWith({ 'x-session-id': SESSION_ID, 'x-user-id': 'legacy-user' })),
    ).resolves.toEqual({ userId: 'u1', venueId: 'v1' });
  });

  it('falls back to the legacy headers when the session is unknown or expired', async () => {
    const resolve = createActorResolver(sessions());
    await expect(
      resolve(reqWith({ 'x-session-id': 'expired-session', 'x-user-id': 'legacy-user' })),
    ).resolves.toEqual({ userId: 'legacy-user', venueId: null });
  });

  it('raises unauthorized when neither transport resolves', async () => {
    const resolve = createActorResolver(sessions());
    await expectUnauthorized(Promise.resolve(resolve(reqWith({}))));
    await expectUnauthorized(Promise.resolve(resolve(reqWith({ 'x-session-id': 'nope' }))));
  });
});

describe('sessionActorResolver / headerActorResolver', () => {
  it('session resolver rejects with unauthorized when the header is missing', async () => {
    const resolve = sessionActorResolver(sessions());
    await expectUnauthorized(Promise.resolve(resolve(reqWith({ 'x-user-id': 'legacy-user' }))));
  });

  it('header resolver is unchanged', () => {
    expect(headerActorResolver(reqWith({ 'x-user-id': 'u9', 'x-venue-id': 'v9' }))).toEqual({
      userId: 'u9',
      venueId: 'v9',
    });
    expect(() => headerActorResolver(reqWith({}))).toThrow(/x-user-id/);
  });
});

// ---------------------------------------------------------------------------
// Route-level: both transports must work end-to-end on the money endpoints.
// ---------------------------------------------------------------------------

interface Harness {
  app: FastifyInstance;
  repo: InMemoryPaymentsRepo;
}

let harness: Harness | null = null;

async function buildApp(): Promise<Harness> {
  const repo = new InMemoryPaymentsRepo();
  repo.seedUser({ userId: 'u1', authProvider: 'google', creditBalance: 0 });
  repo.seedUser({ userId: 'legacy-user', authProvider: 'google', creditBalance: 0 });
  const service = new PaymentsService({
    repo,
    gateway: new FakeGateway(),
    analytics: new RecordingAnalyticsSink(),
  });
  const app = Fastify();
  await registerPaymentRoutes(app, { service, sessionRepo: sessions() });
  await app.ready();
  harness = { app, repo };
  return harness;
}

afterEach(async () => {
  await harness?.app.close();
  harness = null;
});

describe('POST /api/credits/purchase auth transport', () => {
  it('derives the venue for the rev-split from the session (X-Session-Id only)', async () => {
    const { app, repo } = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/credits/purchase',
      headers: { 'x-session-id': SESSION_ID, 'idempotency-key': 'k-session' },
      payload: { bundleId: 'starter_5', paymentMethodToken: 'pm_1' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ creditBalance: 5 });
    // No x-venue-id was sent: the venue came from the session row.
    expect(repo.paymentEvents).toHaveLength(1);
    expect(repo.paymentEvents[0]).toMatchObject({
      userId: 'u1',
      venueId: 'v1',
      paymentType: 'credit_purchase',
      idempotencyKey: 'k-session',
    });
  });

  it('still accepts the legacy x-user-id + x-venue-id headers', async () => {
    const { app, repo } = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/credits/purchase',
      headers: {
        'x-user-id': 'legacy-user',
        'x-venue-id': 'legacy-venue',
        'idempotency-key': 'k-legacy',
      },
      payload: { bundleId: 'starter_5', paymentMethodToken: 'pm_1' },
    });

    expect(res.statusCode).toBe(200);
    expect(repo.paymentEvents[0]).toMatchObject({
      userId: 'legacy-user',
      venueId: 'legacy-venue',
      idempotencyKey: 'k-legacy',
    });
  });

  it('replaying the same Idempotency-Key never double-charges', async () => {
    const { app, repo } = await buildApp();
    const send = () =>
      app.inject({
        method: 'POST',
        url: '/api/credits/purchase',
        headers: { 'x-session-id': SESSION_ID, 'idempotency-key': 'k-dup' },
        payload: { bundleId: 'starter_5', paymentMethodToken: 'pm_1' },
      });

    const first = await send();
    const second = await send();

    expect(first.json()).toEqual({ creditBalance: 5 });
    expect(second.json()).toEqual({ creditBalance: 5 });
    expect(repo.paymentEvents.filter((p) => p.status === 'completed')).toHaveLength(1);
  });

  it('401 unauthorized when no transport identifies the caller', async () => {
    const { app } = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/credits/purchase',
      payload: { bundleId: 'starter_5', paymentMethodToken: 'pm_1' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('unauthorized');
  });
});

describe('boost endpoints auth transport', () => {
  it('POST /api/queue-items/:id/boosts works with X-Session-Id', async () => {
    const { app, repo } = await buildApp();
    repo.users.get('u1')!.creditBalance = 5;
    repo.seedQueueItem({ queueItemId: 'q1', venueId: 'v1' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/queue-items/q1/boosts',
      headers: { 'x-session-id': SESSION_ID, 'idempotency-key': 'b-session' },
      payload: { boostType: 'priority_boost' },
    });

    expect(res.statusCode).toBe(200);
    expect(repo.paymentEvents[0]).toMatchObject({ userId: 'u1', paymentType: 'priority_boost' });
  });

  it('POST /api/boost-codes/redeem works with both transports', async () => {
    const { app, repo } = await buildApp();
    repo.seedBoostCode({ code: 'AAA111', venueId: 'v1', tier: 'beer', creditValue: 1 });
    repo.seedBoostCode({ code: 'BBB222', venueId: 'v1', tier: 'beer', creditValue: 1 });

    const viaSession = await app.inject({
      method: 'POST',
      url: '/api/boost-codes/redeem',
      headers: { 'x-session-id': SESSION_ID },
      payload: { code: 'AAA111' },
    });
    const viaLegacy = await app.inject({
      method: 'POST',
      url: '/api/boost-codes/redeem',
      headers: { 'x-user-id': 'legacy-user' },
      payload: { code: 'BBB222' },
    });

    expect(viaSession.statusCode).toBe(200);
    expect(viaLegacy.statusCode).toBe(200);
    expect(repo.boostCodes.get('AAA111')!.redeemedBy).toBe('u1');
    expect(repo.boostCodes.get('BBB222')!.redeemedBy).toBe('legacy-user');
  });
});
