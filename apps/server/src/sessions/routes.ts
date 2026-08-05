/**
 * Fastify route plugin for the sessions module.
 * Registered by the maintainer at merge time (do not edit apps/server/src/index.ts).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ApiError, JoinSessionRequest, JoinSessionResponse } from '@openaux/shared';
import { unimplementedAuthVerifier, type AuthVerifier } from './auth.js';
import { noopAnalyticsEmitter, type AnalyticsEventEmitter } from './analytics.js';
import { PgSessionRepository, type SessionRepository } from './repository.js';
import { joinSession } from './service.js';

export interface RegisterSessionRoutesOptions {
  repository?: SessionRepository;
  authVerifier?: AuthVerifier;
  analytics?: AnalyticsEventEmitter;
}

interface JoinSessionRoute {
  Body: JoinSessionRequest;
}

/** export function registerSessionRoutes(app) — per CLAUDE.md route-module convention. */
export function registerSessionRoutes(
  app: FastifyInstance,
  opts: RegisterSessionRoutesOptions = {},
): void {
  const repository = opts.repository ?? new PgSessionRepository();
  const authVerifier = opts.authVerifier ?? unimplementedAuthVerifier;
  const analytics = opts.analytics ?? noopAnalyticsEmitter;

  app.post(
    '/api/sessions/join',
    async (request: FastifyRequest<JoinSessionRoute>, reply: FastifyReply) => {
      const body = request.body;
      if (!body || typeof body.venueQrToken !== 'string' || body.venueQrToken.length === 0) {
        const error: ApiError = {
          error: { code: 'not_found', message: 'venueQrToken is required' },
        };
        return reply.status(400).send(error);
      }

      const result = await joinSession(body, { repository, authVerifier, analytics });

      if (!result.ok) {
        const status = result.code === 'unauthorized' ? 401 : 404;
        const error: ApiError = { error: { code: result.code, message: result.message } };
        return reply.status(status).send(error);
      }

      const response: JoinSessionResponse = {
        session: result.session,
        venue: {
          venueId: result.venue.venueId,
          name: result.venue.name,
          controlMode: result.venue.controlMode,
        },
      };
      return reply.status(200).send(response);
    },
  );
}
