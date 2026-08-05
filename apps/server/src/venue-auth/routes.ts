/**
 * Venue-owner HTTP surface: signup, login, me, and venue creation.
 * Exported as a Fastify plugin; the composition root injects the service + verifier.
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type {
  ApiError,
  ApiErrorCode,
  CreateVenueRequest,
  VenueOwnerAuthResponse,
  VenueOwnerLoginRequest,
  VenueOwnerMeResponse,
  VenueOwnerSignupRequest,
} from '@openaux/shared';
import { PgVenueAuthRepository, type VenueAuthRepository } from './repository.js';
import { VenueAuthError, VenueAuthService } from './service.js';
import { createVenueAdminVerifier, type VenueAdminVerifier } from './verifier.js';

function err(code: ApiErrorCode, message: string): ApiError {
  return { error: { code, message } };
}

function bearer(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return null;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match ? match[1]!.trim() : null;
}

export interface VenueAuthRoutesOptions {
  repository?: VenueAuthRepository;
  service?: VenueAuthService;
  verifier?: VenueAdminVerifier;
}

export const registerVenueAuthRoutes: FastifyPluginAsync<VenueAuthRoutesOptions> = async (
  app: FastifyInstance,
  opts: VenueAuthRoutesOptions,
) => {
  const repository = opts.repository ?? new PgVenueAuthRepository();
  const service = opts.service ?? new VenueAuthService({ repository });
  const verifier = opts.verifier ?? createVenueAdminVerifier({ repository });

  function sendAuthError(reply: FastifyReply, e: unknown): boolean {
    if (e instanceof VenueAuthError) {
      const status = e.code === 'unauthorized' ? 401 : 400;
      void reply.code(status).send(err(e.code, e.message));
      return true;
    }
    return false;
  }

  app.post<{ Body: VenueOwnerSignupRequest }>(
    '/api/venue-owners/signup',
    async (request, reply) => {
      const { email, password, displayName } = request.body ?? {};
      try {
        const result = await service.signup(email, password, displayName);
        const body: VenueOwnerAuthResponse = {
          token: result.token,
          expiresAt: result.expiresAt.toISOString(),
          owner: result.owner,
        };
        return reply.code(201).send(body);
      } catch (e) {
        if (sendAuthError(reply, e)) return reply;
        throw e;
      }
    },
  );

  app.post<{ Body: VenueOwnerLoginRequest }>('/api/venue-owners/login', async (request, reply) => {
    const { email, password } = request.body ?? {};
    try {
      const result = await service.login(email, password);
      const body: VenueOwnerAuthResponse = {
        token: result.token,
        expiresAt: result.expiresAt.toISOString(),
        owner: result.owner,
      };
      return reply.send(body);
    } catch (e) {
      if (sendAuthError(reply, e)) return reply;
      throw e;
    }
  });

  app.get('/api/venue-owners/me', async (request, reply) => {
    const ownerId = await verifier.verifyOwner(bearer(request));
    if (!ownerId) return reply.code(401).send(err('unauthorized', 'login required'));
    const owner = await repository.findOwnerById(ownerId);
    if (!owner) return reply.code(401).send(err('unauthorized', 'login required'));
    const venues = await service.listVenues(ownerId);
    const body: VenueOwnerMeResponse = {
      owner: {
        venueOwnerId: owner.venueOwnerId,
        email: owner.email,
        displayName: owner.displayName,
      },
      venues,
    };
    return reply.send(body);
  });

  app.post<{ Body: CreateVenueRequest }>('/api/venues', async (request, reply) => {
    const ownerId = await verifier.verifyOwner(bearer(request));
    if (!ownerId) return reply.code(401).send(err('unauthorized', 'login required'));
    try {
      const venue = await service.createVenue(ownerId, request.body ?? ({} as CreateVenueRequest));
      return reply.code(201).send({ venue });
    } catch (e) {
      if (sendAuthError(reply, e)) return reply;
      throw e;
    }
  });
};
