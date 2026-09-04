/**
 * Fastify route handlers for the queue core. Thin adapters: parse input, resolve the
 * caller's session, delegate to QueueService, and translate QueueError into the
 * ApiError contract shape. No business logic here.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ApiError, CastVoteRequest, CreateRequestRequest } from '@openaux/shared';
import { QueueError, statusForCode } from './errors.js';
import type { QueueService } from './service.js';
import type { QueueRepository } from './repository.js';
import type { MusicProviderResolver } from './seams.js';

/** Session identity is carried in this header (issued by WS1's session layer). */
const SESSION_HEADER = 'x-session-id';
const DEFAULT_SEARCH_LIMIT = 20;

function apiError(code: ApiError['error']['code'], message: string): ApiError {
  return { error: { code, message } };
}

function sendError(reply: FastifyReply, err: unknown): void {
  if (err instanceof QueueError) {
    reply.status(statusForCode(err.code)).send(apiError(err.code, err.message));
    return;
  }
  reply.status(500).send(apiError('internal', 'Unexpected error.'));
}

function getSessionId(request: FastifyRequest): string {
  const header = request.headers[SESSION_HEADER];
  const sessionId = Array.isArray(header) ? header[0] : header;
  if (!sessionId) throw new QueueError('unauthorized', 'Missing session.');
  return sessionId;
}

export function registerQueueRouteHandlers(
  app: FastifyInstance,
  service: QueueService,
  repository: QueueRepository,
  providerResolver: MusicProviderResolver,
): void {
  // GET /api/venues/:venueId/search?q=...
  app.get(
    '/api/venues/:venueId/search',
    async (
      request: FastifyRequest<{
        Params: { venueId: string };
        Querystring: { q?: string | string[] };
      }>,
      reply,
    ) => {
      try {
        await resolveSessionForVenue(request, repository, request.params.venueId);
        const venue = await repository.getVenueConfig(request.params.venueId);
        if (!venue) throw new QueueError('not_found', 'Venue not found.');

        const provider = await providerResolver.getProvider(request.params.venueId);
        const tracks = await provider.searchTracks(getSearchQuery(request), {
          limit: DEFAULT_SEARCH_LIMIT,
        });
        return { tracks };
      } catch (err) {
        return sendError(reply, err);
      }
    },
  );

  // GET /api/venues/:venueId/queue
  app.get(
    '/api/venues/:venueId/queue',
    async (request: FastifyRequest<{ Params: { venueId: string } }>, reply) => {
      try {
        return await service.getQueueSnapshot(request.params.venueId);
      } catch (err) {
        return sendError(reply, err);
      }
    },
  );

  // POST /api/venues/:venueId/requests
  app.post(
    '/api/venues/:venueId/requests',
    async (
      request: FastifyRequest<{ Params: { venueId: string }; Body: CreateRequestRequest }>,
      reply,
    ) => {
      try {
        const sessionId = getSessionId(request);
        const result = await service.createRequest({
          venueId: request.params.venueId,
          sessionId,
          providerTrackId: request.body.providerTrackId,
        });
        return reply.status(201).send(result);
      } catch (err) {
        return sendError(reply, err);
      }
    },
  );

  // PUT /api/queue-items/:queueItemId/vote
  app.put(
    '/api/queue-items/:queueItemId/vote',
    async (
      request: FastifyRequest<{ Params: { queueItemId: string }; Body: CastVoteRequest }>,
      reply,
    ) => {
      try {
        const userId = await resolveUserId(request, repository);
        return await service.castVote({
          queueItemId: request.params.queueItemId,
          userId,
          direction: request.body.direction,
        });
      } catch (err) {
        return sendError(reply, err);
      }
    },
  );

  // DELETE /api/queue-items/:queueItemId/vote
  app.delete(
    '/api/queue-items/:queueItemId/vote',
    async (request: FastifyRequest<{ Params: { queueItemId: string } }>, reply) => {
      try {
        const userId = await resolveUserId(request, repository);
        return await service.removeVote({ queueItemId: request.params.queueItemId, userId });
      } catch (err) {
        return sendError(reply, err);
      }
    },
  );

  // GET /api/queue-items/:queueItemId/position
  app.get(
    '/api/queue-items/:queueItemId/position',
    async (request: FastifyRequest<{ Params: { queueItemId: string } }>, reply) => {
      try {
        return await service.getPosition(request.params.queueItemId);
      } catch (err) {
        return sendError(reply, err);
      }
    },
  );

  // POST /api/queue-items/:queueItemId/skip-vote — crowd-voted skip of the now-playing song
  app.post(
    '/api/queue-items/:queueItemId/skip-vote',
    async (request: FastifyRequest<{ Params: { queueItemId: string } }>, reply) => {
      try {
        const userId = await resolveUserId(request, repository);
        return await service.castCrowdSkipVote({
          queueItemId: request.params.queueItemId,
          userId,
        });
      } catch (err) {
        return sendError(reply, err);
      }
    },
  );
}

function getSearchQuery(
  request: FastifyRequest<{ Querystring: { q?: string | string[] } }>,
): string {
  const rawQuery = request.query.q;
  const query = (Array.isArray(rawQuery) ? rawQuery[0] : rawQuery)?.trim();
  if (!query) {
    throw new QueueError('validation', 'Query parameter "q" is required.');
  }
  return query;
}

async function resolveUserId(
  request: FastifyRequest,
  repository: QueueRepository,
): Promise<string> {
  const session = await resolveSession(request, repository);
  if (!session) throw new QueueError('session_invalid', 'Session not found.');
  return session.userId;
}

async function resolveSessionForVenue(
  request: FastifyRequest,
  repository: QueueRepository,
  venueId: string,
): Promise<void> {
  const session = await resolveSession(request, repository);
  if (!session || session.venueId !== venueId) {
    throw new QueueError('session_invalid', 'No active session for this venue.');
  }
}

async function resolveSession(
  request: FastifyRequest,
  repository: QueueRepository,
) {
  const sessionId = getSessionId(request);
  return repository.getSessionById(sessionId);
}
