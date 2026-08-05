import { describe, expect, it, vi } from 'vitest';
import type { PlaybackTarget, RealtimeEvent, Track } from '@openaux/shared';
import { RealtimePlaybackBridge } from './bridge.js';
import { PlaybackStateStore } from './state.js';

const TARGET: PlaybackTarget = { venueId: 'venue-1', providerDeviceId: 'console' };

const TRACK: Track = {
  provider: 'apple_music',
  providerTrackId: 'am-123',
  title: 'Song',
  artist: 'Artist',
  album: null,
  durationMs: 200_000,
  explicit: false,
  genres: [],
  artworkUrl: null,
};

function bridgeWith(sendResult = true) {
  const sent: Array<{ venueId: string; event: RealtimeEvent }> = [];
  const sendToConsole = vi.fn((venueId: string, event: RealtimeEvent) => {
    sent.push({ venueId, event });
    return sendResult;
  });
  let seq = 0;
  const bridge = new RealtimePlaybackBridge({
    sendToConsole,
    generateCommandId: () => `cmd-${(seq += 1)}`,
  });
  return { bridge, sendToConsole, sent };
}

describe('RealtimePlaybackBridge.send', () => {
  it('relays queueNext as a playback_command event with the track and a commandId', async () => {
    const { bridge, sent } = bridgeWith();
    void bridge.send(TARGET, { type: 'queueNext', track: TRACK });

    expect(sent).toHaveLength(1);
    expect(sent[0]!.venueId).toBe('venue-1');
    expect(sent[0]!.event).toEqual({
      type: 'playback_command',
      payload: { command: 'queue_next', track: TRACK, commandId: 'cmd-1' },
    });
  });

  it.each([
    ['play', { type: 'play' as const }],
    ['pause', { type: 'pause' as const }],
    ['skip', { type: 'skip' as const }],
  ])('relays %s with a null track', async (wire, command) => {
    const { bridge, sent } = bridgeWith();
    void bridge.send(TARGET, command);
    expect(sent[0]!.event).toEqual({
      type: 'playback_command',
      payload: { command: wire, track: null, commandId: 'cmd-1' },
    });
  });

  it('gives each command a unique commandId', async () => {
    const { bridge, sent } = bridgeWith();
    void bridge.send(TARGET, { type: 'play' });
    void bridge.send(TARGET, { type: 'pause' });
    const ids = sent.map((s) => (s.event as { payload: { commandId: string } }).payload.commandId);
    expect(new Set(ids).size).toBe(2);
  });

  it('rejects when no console is connected to relay the command', async () => {
    const { bridge } = bridgeWith(false);
    await expect(bridge.send(TARGET, { type: 'play' })).rejects.toThrow(/No console connection/);
    expect(bridge.pendingCount()).toBe(0);
  });

  it('resolves send() only once the console reports the matching commandId', async () => {
    const { bridge } = bridgeWith();
    let resolved = false;
    const promise = bridge.send(TARGET, { type: 'play' }).then(() => {
      resolved = true;
    });

    expect(bridge.pendingCount()).toBe(1);
    expect(resolved).toBe(false);

    expect(bridge.resolveCommand('cmd-1')).toBe(true);
    await promise;
    expect(resolved).toBe(true);
    expect(bridge.pendingCount()).toBe(0);
  });

  it('resolveCommand returns false for an unknown commandId', () => {
    const { bridge } = bridgeWith();
    expect(bridge.resolveCommand('nope')).toBe(false);
  });

  it('rejects a pending command after commandTimeoutMs', async () => {
    vi.useFakeTimers();
    try {
      const sendToConsole = () => true;
      const bridge = new RealtimePlaybackBridge({
        sendToConsole,
        generateCommandId: () => 'cmd-t',
        commandTimeoutMs: 1000,
      });
      const promise = bridge.send(TARGET, { type: 'play' });
      const assertion = expect(promise).rejects.toThrow(/timed out/);
      await vi.advanceTimersByTimeAsync(1000);
      await assertion;
      expect(bridge.pendingCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('RealtimePlaybackBridge.getNowPlaying', () => {
  it('reads the shared state store', async () => {
    const store = new PlaybackStateStore();
    const bridge = new RealtimePlaybackBridge({ sendToConsole: () => true, stateStore: store });
    store.record('venue-1', { providerTrackId: 'am-999', positionMs: 5000, isPlaying: true });

    const np = await bridge.getNowPlaying(TARGET);
    expect(np.isPlaying).toBe(true);
    expect(np.positionMs).toBe(5000);
    expect(np.track?.providerTrackId).toBe('am-999');
  });

  it('reports silence when nothing has been recorded', async () => {
    const bridge = new RealtimePlaybackBridge({ sendToConsole: () => true });
    expect(await bridge.getNowPlaying(TARGET)).toEqual({
      track: null,
      positionMs: 0,
      isPlaying: false,
    });
  });
});
