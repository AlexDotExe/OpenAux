/**
 * Payments / settlement route module (WS5) — SPEC.md §1 layer 5, §5.
 *
 * Exposes `registerPaymentRoutes`, the Fastify plugin the maintainer wires into
 * apps/server/src/index.ts at merge time. Endpoints (from CONTRACTS.md / api.ts):
 *   POST /api/credits/purchase
 *   POST /api/queue-items/:queueItemId/boosts
 *
 * Everything money-related lives behind pure functions + injectable seams:
 *   - PaymentGateway  (Stripe over fetch; FakeGateway for tests)
 *   - PaymentsRepo    (Postgres over the shared pool; in-memory for tests)
 *   - AnalyticsSink   (WS6 pipeline seam; PG append fallback)
 *   - ActorResolver   (WS1 session/auth seam; header fallback)
 *
 * The queue engine (WS3) calls PaymentsService.settleQueueItem(...) directly at
 * an item's terminal state to trigger auto-refunds (D14). That service is
 * exported here as the in-process seam (see `createPaymentsService`).
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type {
  PurchaseBoostRequest,
  PurchaseBoostResponse,
  PurchaseCreditsRequest,
  PurchaseCreditsResponse,
} from '@openaux/shared';
import { pool } from '../db.js';
import { PaymentsService } from './service.js';
import { PgPaymentsRepo } from './pg-repo.js';
import { PgAnalyticsSink, type AnalyticsSink } from './analytics.js';
import { FakeGateway, StripeGateway, type PaymentGateway } from './gateway.js';
import { headerActorResolver, idempotencyKeyFrom, type ActorResolver } from './auth.js';
import { isPaymentsError, PaymentsError } from './errors.js';
import type { PaymentsRepo } from './repo.js';
import type { BoostType } from './boost-catalog.js';

export interface RegisterPaymentRoutesOptions {
  service?: PaymentsService;
  repo?: PaymentsRepo;
  gateway?: PaymentGateway;
  analytics?: AnalyticsSink;
  actorResolver?: ActorResolver;
}

/** Choose a gateway: Stripe when a key is configured, else a Fake for local dev. */
function defaultGateway(app: FastifyInstance): PaymentGateway {
  if (process.env.STRIPE_SECRET_KEY) return new StripeGateway();
  app.log.warn('STRIPE_SECRET_KEY not set — using FakeGateway (no real charges).');
  return new FakeGateway();
}

/** Build a PaymentsService from the shared pool + default seams. */
export function createPaymentsService(
  app: FastifyInstance,
  opts: RegisterPaymentRoutesOptions = {},
): PaymentsService {
  if (opts.service) return opts.service;
  const repo = opts.repo ?? new PgPaymentsRepo(pool);
  const gateway = opts.gateway ?? defaultGateway(app);
  const analytics = opts.analytics ?? new PgAnalyticsSink(pool, (err) => app.log.error(err));
  return new PaymentsService({ repo, gateway, analytics });
}

const V0_BOOST_TYPES: readonly PurchaseBoostRequest['boostType'][] = [
  'priority_boost',
  'instant_play_vote',
  'super_boost',
];

export async function registerPaymentRoutes(
  app: FastifyInstance,
  opts: RegisterPaymentRoutesOptions = {},
): Promise<void> {
  const service = createPaymentsService(app, opts);
  const resolveActor: ActorResolver = opts.actorResolver ?? headerActorResolver;

  // POST /api/credits/purchase
  app.post('/api/credits/purchase', async (req, reply) => {
    try {
      const actor = await resolveActor(req);
      const body = (req.body ?? {}) as Partial<PurchaseCreditsRequest>;
      if (!body.bundleId || typeof body.bundleId !== 'string') {
        throw new PaymentsError('not_found', 'bundleId is required.');
      }
      if (!body.paymentMethodToken || typeof body.paymentMethodToken !== 'string') {
        throw new PaymentsError('payment_gateway_error', 'paymentMethodToken is required.');
      }
      const venueId = actor.venueId;
      if (!venueId) {
        throw new PaymentsError('unauthorized', 'Missing venue context for purchase.');
      }
      // Clients SHOULD send Idempotency-Key; we generate one when absent so the
      // charge still succeeds (retries without a key are simply not deduped).
      const idempotencyKey = idempotencyKeyFrom(req) ?? randomUUID();

      const { creditBalance } = await service.purchaseCredits({
        userId: actor.userId,
        venueId,
        bundleId: body.bundleId,
        paymentMethodToken: body.paymentMethodToken,
        idempotencyKey,
      });
      const res: PurchaseCreditsResponse = { creditBalance };
      return reply.send(res);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // POST /api/queue-items/:queueItemId/boosts
  app.post<{ Params: { queueItemId: string } }>(
    '/api/queue-items/:queueItemId/boosts',
    async (req, reply) => {
      try {
        const actor = await resolveActor(req);
        const body = (req.body ?? {}) as Partial<PurchaseBoostRequest>;
        const boostType = body.boostType;
        if (!boostType || !V0_BOOST_TYPES.includes(boostType)) {
          throw new PaymentsError('boost_type_unavailable', 'Unknown or missing boostType.');
        }
        const idempotencyKey = idempotencyKeyFrom(req) ?? randomUUID();

        const result = await service.purchaseBoost({
          userId: actor.userId,
          queueItemId: req.params.queueItemId,
          boostType: boostType as BoostType,
          idempotencyKey,
        });

        const queueItem = await service.getQueueItemView(req.params.queueItemId);
        if (!queueItem) throw new PaymentsError('not_found', 'Queue item not found.');
        const res: PurchaseBoostResponse = { queueItem, creditBalance: result.creditBalance };
        return reply.send(res);
      } catch (err) {
        return sendError(reply, err);
      }
    },
  );
}

function sendError(reply: import('fastify').FastifyReply, err: unknown) {
  if (isPaymentsError(err)) {
    return reply.status(err.statusCode).send(err.toEnvelope());
  }
  reply.log.error(err);
  return reply.status(500).send({ error: { code: 'internal', message: 'Internal error.' } });
}

export { PaymentsService } from './service.js';
export { computeRevSplit, DEFAULT_VENUE_SHARE_BPS } from './rev-split.js';
export { CREDIT_BUNDLES, getBundle } from './bundles.js';
export { PgPaymentsRepo } from './pg-repo.js';
export { StripeGateway, FakeGateway } from './gateway.js';
export type { PaymentGateway } from './gateway.js';
export type { PaymentsRepo } from './repo.js';
export { StubPayoutGateway } from './payouts.js';
export type { PayoutGateway } from './payouts.js';
