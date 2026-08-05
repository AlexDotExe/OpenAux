// realtime — see ownership map in CLAUDE.md before editing (WS1: WebSocket channel per venue, broadcast helpers)

/**
 * WS /ws/venues/:venueId — one channel per venue (CONTRACTS.md realtime
 * channel row). Built directly on `ws` (noServer mode) hooked into
 * Fastify's underlying http.Server via the 'upgrade' event, since V0 has no
 * other upgrade-handling plugin to share the port with.
 *
 * Connection roles (realtime-events.ts header):
 *  - Patron: `?sessionId=<sessionId>` (optional) — receives venue broadcasts
 *    and its own SessionExpiredEvent.
 *  - Console: `?role=console&token=<venue admin token>` — the venue operator's
 *    playback device. Authenticated against VENUE_ADMIN_TOKEN (same provisional
 *    shared-secret scheme as venue/auth.ts). Receives venue broadcasts PLUS
 *    playback_command events (sendToConsole). An invalid/absent token is
 *    rejected with a 401 before the socket is upgraded.
 *
 * The `sessionId`/`role`/`token` query params are a WS1 implementation choice,
 * not part of the frozen contract; flag it to the maintainer if the client
 * needs a different handshake shape.
 */
import type { Duplex } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { WebSocketServer } from 'ws';
import type { FastifyInstance } from 'fastify';
import type { RealtimeEvent, SessionExpiredEvent } from '@openaux/shared';
import { ConnectionRegistry, defaultRegistry, type ConnectionRole } from './registry.js';

export { ConnectionRegistry, defaultRegistry } from './registry.js';
export type { RegisteredConnection, ConnectionRole } from './registry.js';

const VENUE_WS_PATH = /^\/ws\/venues\/([^/?]+)\/?$/;

/** Parsed handshake params off the WS upgrade URL. */
export interface ConnectionParams {
  role: ConnectionRole;
  sessionId: string | null;
  token: string | null;
}

export function parseConnectionParams(url: URL): ConnectionParams {
  const role: ConnectionRole = url.searchParams.get('role') === 'console' ? 'console' : 'patron';
  return {
    role,
    sessionId: url.searchParams.get('sessionId'),
    token: url.searchParams.get('token'),
  };
}

/** Constant-time string comparison — avoids leaking token length/prefix via timing. */
function timingSafeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Whether a console connection may register. Mirrors venue/auth.ts's provisional
 * scheme: a single shared secret valid for every venue. Returns false when no
 * token is configured (fail closed) or the provided token doesn't match.
 */
export function authorizeConsole(provided: string | null, expected: string | null): boolean {
  if (!expected || !provided) return false;
  return timingSafeEquals(provided, expected);
}

/** Returns the expected console token for a venue. Default: the VENUE_ADMIN_TOKEN env var. */
export type ConsoleTokenProvider = (venueId: string) => string | null;

const envConsoleTokenProvider: ConsoleTokenProvider = () => process.env.VENUE_ADMIN_TOKEN ?? null;

export interface RegisterRealtimeOptions {
  registry?: ConnectionRegistry;
  /** Override the expected console token lookup (tests). Defaults to VENUE_ADMIN_TOKEN. */
  consoleTokenProvider?: ConsoleTokenProvider;
  /**
   * Owner-session verifier from venue-auth; authoritative when provided (the
   * console presents the same bearer token used for REST admin routes).
   */
  consoleVerify?: (venueId: string, token: string | null) => Promise<boolean>;
}

/** export function registerRealtime(app) — per CLAUDE.md route-module convention. */
export function registerRealtime(app: FastifyInstance, opts: RegisterRealtimeOptions = {}): void {
  const registry = opts.registry ?? defaultRegistry;
  const consoleTokenProvider = opts.consoleTokenProvider ?? envConsoleTokenProvider;
  const consoleVerify = opts.consoleVerify;
  const wss = new WebSocketServer({ noServer: true });

  const onUpgrade = async (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> => {
    const url = new URL(request.url ?? '', 'http://localhost');
    const match = VENUE_WS_PATH.exec(url.pathname);
    if (!match) return; // not our path; V0 has no other upgrade handler to defer to
    const venueId = decodeURIComponent(match[1]!);
    const { role, sessionId, token } = parseConnectionParams(url);

    if (role === 'console') {
      let ok = false;
      try {
        ok = consoleVerify
          ? await consoleVerify(venueId, token)
          : authorizeConsole(token, consoleTokenProvider(venueId));
      } catch {
        ok = false; // verifier error (e.g. DB) → fail closed
      }
      if (!ok) {
        // Reject before upgrading: the console must present a valid venue admin token.
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      // Console connections never carry a patron sessionId.
      const conn = registry.add(venueId, ws, role === 'console' ? null : sessionId, role);
      ws.on('close', () => registry.remove(venueId, conn));
      ws.on('error', () => registry.remove(venueId, conn));
    });
  };

  app.server.on('upgrade', onUpgrade);

  app.addHook('onClose', (_instance, done) => {
    app.server.off('upgrade', onUpgrade);
    wss.close();
    done();
  });
}

/** Fan out a RealtimeEvent to every connection subscribed to a venue's channel. */
export function broadcastToVenue(
  venueId: string,
  event: RealtimeEvent,
  registry: ConnectionRegistry = defaultRegistry,
): void {
  registry.broadcastToVenue(venueId, event);
}

/**
 * Deliver a RealtimeEvent (e.g. a PlaybackCommandEvent) only to a venue's
 * console-role connections. Returns whether at least one open console received
 * it — the RealtimePlaybackBridge uses this to know a command was relayed.
 */
export function sendToConsole(
  venueId: string,
  event: RealtimeEvent,
  registry: ConnectionRegistry = defaultRegistry,
): boolean {
  return registry.sendToConsole(venueId, event);
}

/** Push a SessionExpiredEvent to the single connection tied to that session, if connected. */
export function sendSessionExpired(
  sessionId: string,
  event: SessionExpiredEvent,
  registry: ConnectionRegistry = defaultRegistry,
): boolean {
  return registry.sendToSession(sessionId, event);
}
