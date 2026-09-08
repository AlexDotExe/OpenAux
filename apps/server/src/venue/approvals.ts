/** POST /api/venues/:venueId/approvals/:queueItemId — suggestion-mode decision. */
import type { FastifyInstance } from 'fastify';
import type { ApprovalRequest, ApprovalResponse } from '@openaux/shared';
import { applyApprovalDecision } from './approval-logic.js';
import { errorResponse } from './errors.js';
import { isUuidShape } from './venue-id.js';
import type { VenueRouteContext } from './types.js';

export function registerApprovalsRoute(app: FastifyInstance, ctx: VenueRouteContext): void {
  app.post<{ Params: { venueId: string; queueItemId: string }; Body: ApprovalRequest }>(
    '/api/venues/:venueId/approvals/:queueItemId',
    { preHandler: ctx.adminGuard },
    async (request, reply) => {
      const { venueId, queueItemId } = request.params;
      const decision = request.body?.decision;

      if (decision !== 'approve' && decision !== 'reject') {
        return reply
          .code(400)
          .send(errorResponse('validation', 'decision must be "approve" or "reject"'));
      }

      // queue_items.queue_item_id is a uuid column: a malformed id can never
      // match a row, and passing it into SQL would raise 22P02 (a 500) instead.
      if (!isUuidShape(queueItemId)) {
        return reply.code(404).send(errorResponse('not_found', 'queue item not found'));
      }

      const item = await ctx.repository.getQueueItem(queueItemId);
      if (!item || item.venueId !== venueId) {
        return reply.code(404).send(errorResponse('not_found', 'queue item not found'));
      }

      const outcome = applyApprovalDecision(item, decision);
      if (!outcome.ok) {
        return reply
          .code(409)
          .send(errorResponse('not_found', 'queue item is not awaiting approval'));
      }

      let updated = item;
      if (outcome.playabilityState) {
        updated =
          (await ctx.repository.setPlayabilityState(queueItemId, outcome.playabilityState)) ??
          updated;
      }
      if (outcome.status) {
        updated = (await ctx.repository.setStatus(queueItemId, outcome.status)) ?? updated;
      }

      const response: ApprovalResponse = { queueItem: updated };
      return reply.send(response);
    },
  );
}
