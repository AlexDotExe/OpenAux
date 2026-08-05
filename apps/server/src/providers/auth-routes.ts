/**
 * registerProviderAuthRoutes — Fastify plugin (WS2) for Spotify account
 * linking and playback-device selection. Wired by the maintainer in
 * apps/server/src/index.ts; never edit that file from here.
 *
 * Routes (see CONTRACTS.md / api.ts for shapes):
 *   POST /api/venues/:venueId/spotify/connect   (venue admin) → authorizeUrl
 *   GET  /api/spotify/callback                   (public)      → stores tokens, HTML
 *   GET  /api/venues/:venueId/spotify/status     (venue admin) → link status
 *   GET  /api/venues/:venueId/playback/devices   (venue admin) → Connect devices
 *   PUT  /api/venues/:venueId/playback/device    (venue admin) → persist device id
 *
 * Every network/DB/crypto dependency is injectable so the whole plugin is
 * exercised with a fake fetch, a `{ query }` pool, and an in-test key — no
 * real Spotify calls and no live database.
 */
import type {
  ApiError,
  ApiErrorCode,
  ListPlaybackDevicesResponse,
  PlaybackDevice,
  SetPlaybackDeviceRequest,
  SetPlaybackDeviceResponse,
  SpotifyConnectResponse,
  SpotifyLinkStatusResponse,
  VenueId,
} from '@openaux/shared';
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { pool as sharedPool } from '../db.js';
import { TokenCipher, loadEncryptionKey } from './crypto.js';
import { signState, verifyState } from './oauth-state.js';
import { PgVenueTokenStore, setVenuePlaybackDeviceId, type QueryablePool } from './token-store.js';
import { SpotifyProvider } from './spotify/spotify-provider.js';
import {
  SPOTIFY_PLAYBACK_SCOPES,
  buildAuthorizeUrl,
  exchangeCodeForTokens,
} from './spotify/oauth.js';
import type { FetchLike } from './types.js';

function apiError(code: ApiErrorCode, message: string): ApiError {
  return { error: { code, message } };
}

// --- Local venue-admin guard (same provisional shared-secret pattern as
// apps/server/src/venue/auth.ts; kept here so providers/ imports nothing from
// venue/). Replace with real per-venue operator accounts once designed. ------

function extractBearerToken(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return null;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match ? match[1]!.trim() : null;
}

function timingSafeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

type VenueAdminVerify = (venueId: string, token: string | null) => Promise<boolean>;

function createAdminGuard(getExpectedToken: () => string | null, verify?: VenueAdminVerify) {
  return async function venueAdminGuard(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const provided = extractBearerToken(request.headers.authorization);
    if (verify) {
      const venueId = (request.params as { venueId?: string }).venueId ?? '';
      if (!(await verify(venueId, provided))) {
        await reply.code(401).send(apiError('unauthorized', 'venue admin token required'));
      }
      return;
    }
    const expected = getExpectedToken();
    if (!expected || !provided || !timingSafeEquals(provided, expected)) {
      await reply.code(401).send(apiError('unauthorized', 'venue admin token required'));
    }
  };
}

// --- HTML for the public callback -------------------------------------------

function htmlPage(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;text-align:center"><h1>${title}</h1><p>${body}</p></body></html>`;
}

const SUCCESS_HTML = htmlPage('Spotify connected', 'You can return to the console.');

/** Device listing surface used by the devices route — the concrete provider satisfies it. */
export interface DeviceLister {
  listDevices(venueId: VenueId): Promise<PlaybackDevice[]>;
}

export interface ProviderAuthRoutesOptions {
  /** Defaults to process.env.SPOTIFY_CLIENT_ID. */
  clientId?: string;
  /** Defaults to process.env.SPOTIFY_CLIENT_SECRET. */
  clientSecret?: string;
  /** Defaults to process.env.SPOTIFY_REDIRECT_URI. */
  redirectUri?: string;
  /** Defaults to the playback OAuth scopes. */
  scopes?: readonly string[];
  /** 32-byte key; defaults to loadEncryptionKey(process.env.TOKEN_ENCRYPTION_KEY). */
  encryptionKey?: Buffer;
  /** Defaults to a PgVenueTokenStore over `pool` + the encryption key. */
  tokenStore?: PgVenueTokenStore;
  /** Defaults to a SpotifyProvider backed by `tokenStore`. */
  deviceLister?: DeviceLister;
  /** Pool for the playback_device_id write + default token store. Defaults to the shared pool. */
  pool?: QueryablePool;
  /** Provisional shared venue-admin secret. Defaults to process.env.VENUE_ADMIN_TOKEN. */
  adminToken?: string;
  /** Owner-session verifier from venue-auth; authoritative when provided. */
  adminVerify?: VenueAdminVerify;
  fetchImpl?: FetchLike;
}

export const registerProviderAuthRoutes: FastifyPluginAsync<ProviderAuthRoutesOptions> = async (
  app: FastifyInstance,
  opts: ProviderAuthRoutesOptions,
) => {
  const encryptionKey = opts.encryptionKey ?? loadEncryptionKey(process.env.TOKEN_ENCRYPTION_KEY);
  const cipher = new TokenCipher(encryptionKey);
  const pool = opts.pool ?? sharedPool;
  const tokenStore = opts.tokenStore ?? new PgVenueTokenStore(pool, cipher);
  const clientId = opts.clientId ?? process.env.SPOTIFY_CLIENT_ID ?? '';
  const clientSecret = opts.clientSecret ?? process.env.SPOTIFY_CLIENT_SECRET ?? '';
  const redirectUri = opts.redirectUri ?? process.env.SPOTIFY_REDIRECT_URI ?? '';
  const scopes = opts.scopes ?? SPOTIFY_PLAYBACK_SCOPES;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const deviceLister: DeviceLister =
    opts.deviceLister ?? new SpotifyProvider({ clientId, clientSecret, tokenStore, fetchImpl });

  const adminGuard = createAdminGuard(
    () => opts.adminToken ?? process.env.VENUE_ADMIN_TOKEN ?? null,
    opts.adminVerify,
  );

  // POST /api/venues/:venueId/spotify/connect --------------------------------
  app.post<{ Params: { venueId: string } }>(
    '/api/venues/:venueId/spotify/connect',
    { preHandler: adminGuard },
    async (request, reply) => {
      if (!clientId || !redirectUri) {
        return reply
          .code(500)
          .send(apiError('internal', 'Spotify OAuth is not configured on the server.'));
      }
      const state = signState(request.params.venueId, encryptionKey);
      const authorizeUrl = buildAuthorizeUrl({ clientId, redirectUri, state, scopes });
      const response: SpotifyConnectResponse = { authorizeUrl };
      return reply.send(response);
    },
  );

  // GET /api/spotify/callback (public) ---------------------------------------
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/api/spotify/callback',
    async (request, reply) => {
      const { code, state, error } = request.query;
      const sendHtml = (status: number, title: string, body: string) =>
        reply.code(status).type('text/html').send(htmlPage(title, body));

      if (error) {
        return sendHtml(
          400,
          'Spotify not connected',
          'Authorization was denied. You can retry from the console.',
        );
      }
      if (!code || !state) {
        return sendHtml(
          400,
          'Spotify not connected',
          'The callback was missing required parameters.',
        );
      }
      const verified = verifyState(state, encryptionKey);
      if (!verified.valid) {
        return sendHtml(
          400,
          'Spotify not connected',
          'This authorization link is invalid or has expired. Please retry from the console.',
        );
      }
      let tokens;
      try {
        tokens = await exchangeCodeForTokens({
          code,
          clientId,
          clientSecret,
          redirectUri,
          fetchImpl,
        });
      } catch {
        return sendHtml(
          502,
          'Spotify not connected',
          'We could not complete the Spotify connection. Please retry from the console.',
        );
      }
      await tokenStore.link(verified.venueId, tokens);
      return reply.type('text/html').send(SUCCESS_HTML);
    },
  );

  // GET /api/venues/:venueId/spotify/status ----------------------------------
  app.get<{ Params: { venueId: string } }>(
    '/api/venues/:venueId/spotify/status',
    { preHandler: adminGuard },
    async (request, reply) => {
      const status = await tokenStore.getStatus(request.params.venueId);
      const response: SpotifyLinkStatusResponse = {
        linked: status.linked,
        scope: status.scope,
        expiresAt: status.expiresAt ? status.expiresAt.toISOString() : null,
      };
      return reply.send(response);
    },
  );

  // GET /api/venues/:venueId/playback/devices --------------------------------
  app.get<{ Params: { venueId: string } }>(
    '/api/venues/:venueId/playback/devices',
    { preHandler: adminGuard },
    async (request, reply) => {
      const { venueId } = request.params;
      const status = await tokenStore.getStatus(venueId);
      if (!status.linked) {
        return reply
          .code(400)
          .send(apiError('validation', 'No Spotify account is connected for this venue.'));
      }
      let devices: PlaybackDevice[];
      try {
        devices = await deviceLister.listDevices(venueId);
      } catch {
        return reply
          .code(502)
          .send(apiError('internal', 'Failed to list Spotify devices for this venue.'));
      }
      const response: ListPlaybackDevicesResponse = { devices };
      return reply.send(response);
    },
  );

  // PUT /api/venues/:venueId/playback/device ---------------------------------
  app.put<{ Params: { venueId: string }; Body: SetPlaybackDeviceRequest }>(
    '/api/venues/:venueId/playback/device',
    { preHandler: adminGuard },
    async (request, reply) => {
      const providerDeviceId = request.body?.providerDeviceId;
      if (typeof providerDeviceId !== 'string' || providerDeviceId.trim() === '') {
        return reply.code(400).send(apiError('validation', 'providerDeviceId is required.'));
      }
      const updated = await setVenuePlaybackDeviceId(
        pool,
        request.params.venueId,
        providerDeviceId,
      );
      if (!updated) {
        return reply.code(404).send(apiError('not_found', 'venue not found'));
      }
      const response: SetPlaybackDeviceResponse = { playbackDeviceId: providerDeviceId };
      return reply.send(response);
    },
  );
};
