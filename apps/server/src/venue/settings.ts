/** PATCH /api/venues/:venueId/settings */
import type { FastifyInstance } from 'fastify';
import type { UpdateVenueSettingsRequest, UpdateVenueSettingsResponse } from '@openaux/shared';
import { errorResponse } from './errors.js';
import { validateSettingsUpdate } from './settings-logic.js';
import type { VenueRouteContext } from './types.js';

export function registerSettingsRoute(app: FastifyInstance, ctx: VenueRouteContext): void {
  app.patch<{ Params: { venueId: string }; Body: UpdateVenueSettingsRequest }>(
    '/api/venues/:venueId/settings',
    { preHandler: ctx.adminGuard },
    async (request, reply) => {
      const { venueId } = request.params;
      const validation = validateSettingsUpdate(request.body ?? {});
      if (!validation.valid) {
        return reply.code(400).send(errorResponse('validation', validation.message));
      }

      const updated = await ctx.repository.updateSettings(venueId, validation.patch);
      if (!updated) {
        return reply.code(404).send(errorResponse('not_found', 'venue not found'));
      }
      const response: UpdateVenueSettingsResponse = { venue: updated };
      return reply.send(response);
    },
  );
}
