/**
 * Venue read endpoints:
 *   GET /api/venues/:venueId                    — public VenueSummary (name, QR, block settings)
 *   GET /api/venues/:venueId/fallback-playlist  — venue-admin: current fallback playlist
 *
 * The summary is public (the console shows it before a session/admin token
 * exists, for the QR/session display); the fallback-playlist read is behind the
 * venue-admin guard like the rest of the admin surface.
 */
import type { FastifyInstance } from 'fastify';
import type { GetFallbackPlaylistResponse, VenueSummary } from '@openaux/shared';
import { errorResponse } from './errors.js';
import type { VenueRouteContext } from './types.js';

export function registerVenueReadRoutes(app: FastifyInstance, ctx: VenueRouteContext): void {
  app.get<{ Params: { venueId: string } }>('/api/venues/:venueId', async (request, reply) => {
    const summary = await ctx.repository.getVenueSummary(request.params.venueId);
    if (!summary) {
      return reply.code(404).send(errorResponse('not_found', 'venue not found'));
    }
    const response: VenueSummary = summary;
    return reply.send(response);
  });

  app.get<{ Params: { venueId: string } }>(
    '/api/venues/:venueId/fallback-playlist',
    { preHandler: ctx.adminGuard },
    async (request, reply) => {
      const providerTrackIds = await ctx.repository.getFallbackPlaylist(request.params.venueId);
      const response: GetFallbackPlaylistResponse = { providerTrackIds };
      return reply.send(response);
    },
  );
}
