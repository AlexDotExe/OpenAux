/** PUT /api/venues/:venueId/fallback-playlist — silence-fallback playlist. */
import type { FastifyInstance } from 'fastify';
import type { SetFallbackPlaylistRequest, SetFallbackPlaylistResponse } from '@openaux/shared';
import { errorResponse } from './errors.js';
import type { VenueRouteContext } from './types.js';

export function registerFallbackPlaylistRoute(app: FastifyInstance, ctx: VenueRouteContext): void {
  app.put<{ Params: { venueId: string }; Body: SetFallbackPlaylistRequest }>(
    '/api/venues/:venueId/fallback-playlist',
    { preHandler: ctx.adminGuard },
    async (request, reply) => {
      const { venueId } = request.params;
      const providerTrackIds = request.body?.providerTrackIds;

      if (
        !Array.isArray(providerTrackIds) ||
        providerTrackIds.length === 0 ||
        providerTrackIds.some((id) => typeof id !== 'string' || id.trim().length === 0)
      ) {
        return reply
          .code(400)
          .send(
            errorResponse('validation', 'providerTrackIds must be a non-empty array of strings'),
          );
      }

      await ctx.repository.setFallbackPlaylist(venueId, providerTrackIds);
      const response: SetFallbackPlaylistResponse = { providerTrackIds };
      return reply.send(response);
    },
  );
}
