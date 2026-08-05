/** POST /api/venues/:venueId/anthem — set anthem track + promo. */
import type { FastifyInstance } from 'fastify';
import type { SetAnthemRequest, SetAnthemResponse } from '@openaux/shared';
import { validateAnthemRequest } from './anthem-logic.js';
import { buildVenueAnthemAnnouncementText, emitAnnouncement } from './announcements.js';
import { errorResponse } from './errors.js';
import type { AnthemConfig, VenueRouteContext } from './types.js';

const VENUE_ANTHEM_ANNOUNCEMENT_TTL_SECONDS = 20;

export function registerAnthemRoute(app: FastifyInstance, ctx: VenueRouteContext): void {
  app.post<{ Params: { venueId: string }; Body: SetAnthemRequest }>(
    '/api/venues/:venueId/anthem',
    { preHandler: ctx.adminGuard },
    async (request, reply) => {
      const { venueId } = request.params;
      const body = request.body ?? ({} as SetAnthemRequest);

      const validation = validateAnthemRequest(body);
      if (!validation.valid) {
        return reply.code(400).send(errorResponse('validation', validation.message));
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

      const anthem: AnthemConfig = {
        provider: providerId,
        providerTrackId: body.providerTrackId,
        title: track.title,
        artist: track.artist,
        promoText: body.promoText,
        promoDurationMinutes: body.promoDurationMinutes,
      };

      await ctx.repository.setAnthem(venueId, anthem);
      emitAnnouncement(
        ctx.broadcaster,
        venueId,
        'venue_anthem',
        buildVenueAnthemAnnouncementText(anthem),
        VENUE_ANTHEM_ANNOUNCEMENT_TTL_SECONDS,
      );

      const response: SetAnthemResponse = { anthem };
      return reply.code(201).send(response);
    },
  );
}
