/**
 * POST /api/venues/:venueId/power-hour — activate Power Hour Mode (SPEC.md §5 V1).
 *
 * Persists the window on the venues row, pushes a `power_hour_activated` banner
 * event, and records the `power_hour_activated` analytics event. WS3 queue
 * scoring reads venues.power_hour_* directly to apply the multiplier.
 *
 * No-background-timer expiry: `reconcilePowerHourOnRead` is called from the
 * public venue read (venue-read.ts). The first read after a window elapses
 * clears the columns and broadcasts `power_hour_ended`.
 */
import type { FastifyInstance } from 'fastify';
import type {
  ActivatePowerHourRequest,
  ActivatePowerHourResponse,
  PowerHourEndedEvent,
} from '@openaux/shared';
import { errorResponse } from './errors.js';
import {
  buildPowerHourBannerText,
  isPowerHourExpired,
  powerHourEndsAt,
  validatePowerHourRequest,
} from './power-hour-logic.js';
import type { VenueRouteContext } from './types.js';

/**
 * Lazily expire a stored Power Hour window when a read observes it has elapsed:
 * clear the venue columns and broadcast `power_hour_ended` exactly once (the
 * clear makes subsequent reads a no-op). Safe to call on any read path.
 */
export async function reconcilePowerHourOnRead(
  ctx: Pick<VenueRouteContext, 'repository' | 'broadcaster'>,
  venueId: string,
  now: Date,
): Promise<void> {
  const record = await ctx.repository.getPowerHour(venueId);
  if (!record) return;
  if (isPowerHourExpired(record, now)) {
    await ctx.repository.clearPowerHour(venueId);
    const event: PowerHourEndedEvent = {
      type: 'power_hour_ended',
      payload: { genre: record.genre },
    };
    ctx.broadcaster.broadcastToVenue(venueId, event);
  }
}

export function registerPowerHourRoute(app: FastifyInstance, ctx: VenueRouteContext): void {
  app.post<{ Params: { venueId: string }; Body: ActivatePowerHourRequest }>(
    '/api/venues/:venueId/power-hour',
    { preHandler: ctx.adminGuard },
    async (request, reply) => {
      const { venueId } = request.params;
      const body = request.body ?? ({} as ActivatePowerHourRequest);

      const validation = validatePowerHourRequest(body);
      if (!validation.valid) {
        return reply.code(400).send(errorResponse('validation', validation.message));
      }

      // Reuse the provider lookup as an existence check (returns null for unknown venues).
      const providerId = await ctx.repository.getMusicProviderId(venueId);
      if (!providerId) {
        return reply.code(404).send(errorResponse('not_found', 'venue not found'));
      }

      const now = new Date();
      const endsAt = powerHourEndsAt(now, body.durationMinutes);
      const genre = body.genre.trim();
      await ctx.repository.setPowerHour(venueId, {
        genre,
        multiplier: body.multiplier,
        endsAt,
      });

      ctx.broadcaster.broadcastToVenue(venueId, {
        type: 'power_hour_activated',
        payload: {
          genre,
          multiplier: body.multiplier,
          endsAt: endsAt.toISOString(),
          bannerText: buildPowerHourBannerText(genre, body.multiplier),
        },
      });

      ctx.analytics.record({
        eventType: 'power_hour_activated',
        venueId,
        metadata: {
          genre,
          multiplier: body.multiplier,
          durationMinutes: body.durationMinutes,
          endsAt: endsAt.toISOString(),
        },
      });

      const response: ActivatePowerHourResponse = {
        powerHour: { genre, multiplier: body.multiplier, endsAt: endsAt.toISOString() },
      };
      return reply.code(201).send(response);
    },
  );
}
