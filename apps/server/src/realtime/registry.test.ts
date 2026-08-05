import { describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import type { PlaybackCommandEvent, QueueSnapshot } from '@openaux/shared';
import { ConnectionRegistry, type RegisteredConnection } from './registry.js';

function mockSocket(
  readyState: RegisteredConnection['ws']['readyState'] = WebSocket.OPEN,
): RegisteredConnection['ws'] {
  return { readyState, send: vi.fn() };
}

const EMPTY_QUEUE: QueueSnapshot = { nowPlaying: null, upNext: [], rest: [] };

describe('ConnectionRegistry.broadcastToVenue', () => {
  it('fans an event out to every open connection on that venue', () => {
    const registry = new ConnectionRegistry();
    const a = mockSocket();
    const b = mockSocket();
    registry.add('venue-1', a, null);
    registry.add('venue-1', b, null);

    registry.broadcastToVenue('venue-1', { type: 'queue_updated', payload: EMPTY_QUEUE });

    const message = JSON.stringify({ type: 'queue_updated', payload: EMPTY_QUEUE });
    expect(a.send).toHaveBeenCalledWith(message);
    expect(b.send).toHaveBeenCalledWith(message);
  });

  it('does not send to a connection on a different venue', () => {
    const registry = new ConnectionRegistry();
    const other = mockSocket();
    registry.add('venue-2', other, null);

    registry.broadcastToVenue('venue-1', { type: 'queue_updated', payload: EMPTY_QUEUE });

    expect(other.send).not.toHaveBeenCalled();
  });

  it('skips connections that are not open', () => {
    const registry = new ConnectionRegistry();
    const closed = mockSocket(WebSocket.CLOSED);
    const open = mockSocket(WebSocket.OPEN);
    registry.add('venue-1', closed, null);
    registry.add('venue-1', open, null);

    registry.broadcastToVenue('venue-1', { type: 'queue_updated', payload: EMPTY_QUEUE });

    expect(closed.send).not.toHaveBeenCalled();
    expect(open.send).toHaveBeenCalledTimes(1);
  });

  it('is a no-op for a venue with no connections', () => {
    const registry = new ConnectionRegistry();
    expect(() =>
      registry.broadcastToVenue('empty-venue', { type: 'queue_updated', payload: EMPTY_QUEUE }),
    ).not.toThrow();
  });

  it('drops a connection after it is removed', () => {
    const registry = new ConnectionRegistry();
    const ws = mockSocket();
    const conn = registry.add('venue-1', ws, null);
    registry.remove('venue-1', conn);

    registry.broadcastToVenue('venue-1', { type: 'queue_updated', payload: EMPTY_QUEUE });

    expect(ws.send).not.toHaveBeenCalled();
    expect(registry.connectionCount('venue-1')).toBe(0);
  });
});

describe('ConnectionRegistry.sendToSession', () => {
  it('delivers a SessionExpiredEvent to the connection tied to that sessionId', () => {
    const registry = new ConnectionRegistry();
    const ws = mockSocket();
    registry.add('venue-1', ws, 'session-42');

    const delivered = registry.sendToSession('session-42', {
      type: 'session_expired',
      payload: { sessionId: 'session-42' },
    });

    expect(delivered).toBe(true);
    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'session_expired', payload: { sessionId: 'session-42' } }),
    );
  });

  it('does not deliver to other connections on the same venue', () => {
    const registry = new ConnectionRegistry();
    const target = mockSocket();
    const bystander = mockSocket();
    registry.add('venue-1', target, 'session-42');
    registry.add('venue-1', bystander, 'session-99');

    registry.sendToSession('session-42', {
      type: 'session_expired',
      payload: { sessionId: 'session-42' },
    });

    expect(bystander.send).not.toHaveBeenCalled();
  });

  it('returns false for an unknown sessionId', () => {
    const registry = new ConnectionRegistry();
    const delivered = registry.sendToSession('missing', {
      type: 'session_expired',
      payload: { sessionId: 'missing' },
    });
    expect(delivered).toBe(false);
  });

  it('returns false and does not send when the connection is closed', () => {
    const registry = new ConnectionRegistry();
    const ws = mockSocket(WebSocket.CLOSED);
    registry.add('venue-1', ws, 'session-42');

    const delivered = registry.sendToSession('session-42', {
      type: 'session_expired',
      payload: { sessionId: 'session-42' },
    });

    expect(delivered).toBe(false);
    expect(ws.send).not.toHaveBeenCalled();
  });
});

const PLAYBACK_COMMAND: PlaybackCommandEvent = {
  type: 'playback_command',
  payload: { command: 'play', track: null, commandId: 'cmd-1' },
};

describe('ConnectionRegistry console role', () => {
  it('registers a console connection and reports its role', () => {
    const registry = new ConnectionRegistry();
    registry.add('venue-1', mockSocket(), null, 'console');
    expect(registry.consoleCount('venue-1')).toBe(1);
    expect(registry.connectionCount('venue-1')).toBe(1);
  });

  it('sendToConsole delivers only to console connections, not patrons', () => {
    const registry = new ConnectionRegistry();
    const console1 = mockSocket();
    const patron = mockSocket();
    registry.add('venue-1', console1, null, 'console');
    registry.add('venue-1', patron, 'session-1', 'patron');

    const delivered = registry.sendToConsole('venue-1', PLAYBACK_COMMAND);

    expect(delivered).toBe(true);
    expect(console1.send).toHaveBeenCalledWith(JSON.stringify(PLAYBACK_COMMAND));
    expect(patron.send).not.toHaveBeenCalled();
  });

  it('console connections still receive normal venue broadcasts', () => {
    const registry = new ConnectionRegistry();
    const console1 = mockSocket();
    registry.add('venue-1', console1, null, 'console');

    registry.broadcastToVenue('venue-1', { type: 'queue_updated', payload: EMPTY_QUEUE });

    expect(console1.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'queue_updated', payload: EMPTY_QUEUE }),
    );
  });

  it('sendToConsole returns false when no console is connected', () => {
    const registry = new ConnectionRegistry();
    registry.add('venue-1', mockSocket(), 'session-1', 'patron');
    expect(registry.sendToConsole('venue-1', PLAYBACK_COMMAND)).toBe(false);
  });

  it('sendToConsole skips a closed console connection', () => {
    const registry = new ConnectionRegistry();
    const closed = mockSocket(WebSocket.CLOSED);
    registry.add('venue-1', closed, null, 'console');
    expect(registry.sendToConsole('venue-1', PLAYBACK_COMMAND)).toBe(false);
    expect(closed.send).not.toHaveBeenCalled();
  });
});
