/** POST /api/venues/:venueId/skip — skip the current song. */
import type { FastifyInstance } from 'fastify';
import type { SkipRequest, SkipResponse } from '@openaux/shared';
import { errorResponse } from './errors.js';
import type { VenueRouteContext } from './types.js';

export function registerSkipRoute(app: FastifyInstance, ctx: VenueRouteContext): void {
  app.post<{ Params: { venueId: string }; Body: SkipRequest }>(
    '/api/venues/:venueId/skip',
    { preHandler: ctx.adminGuard },
    async (request, reply) => {
      const { venueId } = request.params;

      const current = await ctx.repository.getCurrentlyPlaying(venueId);
      if (!current) {
        return reply.code(404).send(errorResponse('not_found', 'no song is currently playing'));
      }

      const updated = await ctx.repository.setStatus(current.queueItemId, 'skipped');
      await ctx.queueControl.skipCurrent(venueId);

      ctx.analytics.record({
        eventType: 'song_skipped',
        venueId,
        queueItemId: current.queueItemId,
        actorUserId: null,
        metadata: { skippedBy: 'venue' },
      });

      const response: SkipResponse = { queueItem: updated ?? current };
      return reply.send(response);
    },
  );
}
