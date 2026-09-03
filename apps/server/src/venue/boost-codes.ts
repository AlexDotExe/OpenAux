/**
 * Boost Code generation + listing (decision D7):
 *   POST /api/venues/:venueId/boost-codes — mint a single-use code for a tier
 *   GET  /api/venues/:venueId/boost-codes — list codes issued by this venue
 *
 * credit_value is fixed by the tier server-side; codes expire 30 min after
 * issue. Redemption is NOT owned here — WS5 payments owns
 * POST /api/boost-codes/redeem and the redeemed_by/redeemed_at write.
 */
import { randomInt } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type {
  GenerateBoostCodeRequest,
  GenerateBoostCodeResponse,
  ListBoostCodesResponse,
} from '@openaux/shared';
import {
  buildNewBoostCode,
  generateBoostCodeString,
  toBoostCodePublic,
  validateGenerateBoostCodeRequest,
} from './boost-code-logic.js';
import { errorResponse } from './errors.js';
import { BoostCodeConflictError, type VenueRouteContext } from './types.js';

/** Bounded retries to dodge the astronomically rare code-string collision. */
const MAX_GENERATION_ATTEMPTS = 5;

export function registerBoostCodesRoutes(app: FastifyInstance, ctx: VenueRouteContext): void {
  app.post<{ Params: { venueId: string }; Body: GenerateBoostCodeRequest }>(
    '/api/venues/:venueId/boost-codes',
    { preHandler: ctx.adminGuard },
    async (request, reply) => {
      const { venueId } = request.params;
      const validation = validateGenerateBoostCodeRequest(request.body ?? {});
      if (!validation.valid) {
        return reply.code(400).send(errorResponse('validation', validation.message));
      }

      // Reuse the provider lookup as an existence check (returns null for unknown venues).
      const providerId = await ctx.repository.getMusicProviderId(venueId);
      if (!providerId) {
        return reply.code(404).send(errorResponse('not_found', 'venue not found'));
      }

      const issuedAt = new Date();
      let inserted = null;
      for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
        const code = generateBoostCodeString((max) => randomInt(max));
        const newBoostCode = buildNewBoostCode({ code, venueId, tier: validation.tier, issuedAt });
        try {
          inserted = await ctx.boostCodeRepository.insert(newBoostCode);
          break;
        } catch (err) {
          if (err instanceof BoostCodeConflictError) continue;
          throw err;
        }
      }
      if (!inserted) {
        return reply
          .code(500)
          .send(errorResponse('internal', 'could not generate a unique boost code'));
      }

      ctx.analytics.record({
        eventType: 'boost_code_generated',
        venueId,
        metadata: {
          boostCodeId: inserted.boostCodeId,
          tier: inserted.tier,
          creditValue: inserted.creditValue,
          expiresAt: inserted.expiresAt.toISOString(),
        },
      });

      const response: GenerateBoostCodeResponse = { boostCode: toBoostCodePublic(inserted) };
      return reply.code(201).send(response);
    },
  );

  app.get<{ Params: { venueId: string } }>(
    '/api/venues/:venueId/boost-codes',
    { preHandler: ctx.adminGuard },
    async (request, reply) => {
      const { venueId } = request.params;
      const codes = await ctx.boostCodeRepository.listByVenue(venueId);
      const response: ListBoostCodesResponse = { boostCodes: codes.map(toBoostCodePublic) };
      return reply.send(response);
    },
  );
}
