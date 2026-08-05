/** POST /api/venues/:venueId/overrides — venue plays a track now/next. */
import type { FastifyInstance } from 'fastify';
import type { VenueOverrideRequest, VenueOverrideResponse } from '@openaux/shared';
import { errorResponse } from './errors.js';
import type { VenueRouteContext } from './types.js';

export function registerOverridesRoute(app: FastifyInstance, ctx: VenueRouteContext): void {
  app.post<{ Params: { venueId: string }; Body: VenueOverrideRequest }>(
    '/api/venues/:venueId/overrides',
    { preHandler: ctx.adminGuard },
    async (request, reply) => {
      const { venueId } = request.params;
      const body = request.body ?? ({} as VenueOverrideRequest);

      if (typeof body.providerTrackId !== 'string' || body.providerTrackId.trim().length === 0) {
        return reply.code(400).send(errorResponse('validation', 'providerTrackId is required'));
      }
      if (body.when !== 'now' && body.when !== 'next') {
        return reply.code(400).send(errorResponse('validation', 'when must be "now" or "next"'));
      }
      if (!ctx.resolveMusicProvider) {
        return reply
          .code(500)
          .send(errorResponse('internal', 'music provider not wired (WS2 dependency missing)'));
      }

      const providerId = await ctx.repository.getMusicProviderId(venueId);
      if (!providerId) {
        return reply.code(404).send(errorResponse('not_found', 'venue not found'));
      }

      const provider = ctx.resolveMusicProvider(providerId);
      const track = await provider.getTrack(body.providerTrackId);
      if (!track) {
        return reply.code(404).send(errorResponse('not_found', 'track not found'));
      }

      const actorUserId = await ctx.repository.getOrCreateVenueActorUserId(venueId);
      const queueItem = await ctx.repository.insertQueueItem({
        venueId,
        track,
        requestingUserId: actorUserId,
        sourceType: 'override',
        playabilityState: 'playable',
      });

      await ctx.queueControl.insertOverride({
        venueId,
        queueItemId: queueItem.queueItemId,
        when: body.when,
      });

      ctx.analytics.record({
        eventType: 'venue_override_used',
        venueId,
        queueItemId: queueItem.queueItemId,
        metadata: { when: body.when, providerTrackId: body.providerTrackId },
      });

      const response: VenueOverrideResponse = { queueItem };
      return reply.code(201).send(response);
    },
  );
}
