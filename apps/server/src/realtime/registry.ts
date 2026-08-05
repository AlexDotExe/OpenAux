/**
 * In-memory registry of live venue WebSocket connections.
 *
 * Not persisted — a process restart drops all connections; clients
 * reconnect and re-join. Kept as a small class (rather than bare module
 * state) so tests can construct isolated instances with mock sockets.
 *
 * Connections carry a role: 'patron' (default) or 'console' (the venue
 * operator's playback device — see realtime-events.ts). Console connections
 * additionally receive playback_command events via sendToConsole; both roles
 * receive the normal venue broadcasts.
 */
import { WebSocket } from 'ws';
import type { RealtimeEvent, SessionExpiredEvent } from '@openaux/shared';

export type ConnectionRole = 'patron' | 'console';

export interface RegisteredConnection {
  ws: Pick<WebSocket, 'readyState' | 'send'>;
  /** Null for connections that didn't identify a sessionId (still receives venue broadcasts). */
  sessionId: string | null;
  /** 'console' for the venue operator's playback device; 'patron' otherwise. */
  role: ConnectionRole;
}

export class ConnectionRegistry {
  private readonly byVenue = new Map<string, Set<RegisteredConnection>>();
  private readonly bySession = new Map<string, RegisteredConnection>();

  add(
    venueId: string,
    ws: RegisteredConnection['ws'],
    sessionId: string | null,
    role: ConnectionRole = 'patron',
  ): RegisteredConnection {
    const conn: RegisteredConnection = { ws, sessionId, role };
    let set = this.byVenue.get(venueId);
    if (!set) {
      set = new Set();
      this.byVenue.set(venueId, set);
    }
    set.add(conn);
    if (sessionId) this.bySession.set(sessionId, conn);
    return conn;
  }

  remove(venueId: string, conn: RegisteredConnection): void {
    const set = this.byVenue.get(venueId);
    set?.delete(conn);
    if (set && set.size === 0) this.byVenue.delete(venueId);
    if (conn.sessionId && this.bySession.get(conn.sessionId) === conn) {
      this.bySession.delete(conn.sessionId);
    }
  }

  connectionCount(venueId: string): number {
    return this.byVenue.get(venueId)?.size ?? 0;
  }

  /** Number of live console connections on a venue's channel (test/introspection helper). */
  consoleCount(venueId: string): number {
    const set = this.byVenue.get(venueId);
    if (!set) return 0;
    let count = 0;
    for (const conn of set) if (conn.role === 'console') count += 1;
    return count;
  }

  /** Fan out a RealtimeEvent to every open connection on a venue's channel. */
  broadcastToVenue(venueId: string, event: RealtimeEvent): void {
    const set = this.byVenue.get(venueId);
    if (!set) return;
    const message = JSON.stringify(event);
    for (const conn of set) {
      if (conn.ws.readyState === WebSocket.OPEN) {
        conn.ws.send(message);
      }
    }
  }

  /**
   * Send a RealtimeEvent (e.g. a PlaybackCommandEvent) only to the console-role
   * connections on a venue's channel. Returns whether it was delivered to at
   * least one open console connection.
   */
  sendToConsole(venueId: string, event: RealtimeEvent): boolean {
    const set = this.byVenue.get(venueId);
    if (!set) return false;
    const message = JSON.stringify(event);
    let delivered = false;
    for (const conn of set) {
      if (conn.role === 'console' && conn.ws.readyState === WebSocket.OPEN) {
        conn.ws.send(message);
        delivered = true;
      }
    }
    return delivered;
  }

  /** Send a SessionExpiredEvent to the one connection tied to that session, if any. Returns whether it was delivered. */
  sendToSession(sessionId: string, event: SessionExpiredEvent): boolean {
    const conn = this.bySession.get(sessionId);
    if (!conn || conn.ws.readyState !== WebSocket.OPEN) return false;
    conn.ws.send(JSON.stringify(event));
    return true;
  }
}

/** Process-wide singleton used by the exported broadcastToVenue/sendSessionExpired helpers. */
export const defaultRegistry = new ConnectionRegistry();
