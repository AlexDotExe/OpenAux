/**
 * RealtimePlaybackBridge — the concrete PlaybackBridge (providers/types.ts)
 * that WS2's AppleMusicProvider relays through. Apple Music has no server-side
 * playback API, so play/pause/skip/queueNext are forwarded as
 * PlaybackCommandEvents down the venue's console WebSocket (realtime/
 * sendToConsole) and executed there by MusicKit JS.
 *
 * Each command gets a unique commandId; send() returns a promise that settles
 * when the console echoes that commandId back in a playback-state report
 * (resolveCommand, called from the state route) — so
 * AppleMusicProvider.play(target) resolves once the venue device actually acted.
 * getNowPlaying reads the shared PlaybackStateStore that the state route writes.
 */
import type { NowPlayingState, PlaybackTarget, RealtimeEvent, Track } from '@openaux/shared';
import type { PlaybackBridge, PlaybackCommand } from '../providers/index.js';
import { PlaybackStateStore } from './state.js';

/** Wire mapping: MusicProvider PlaybackCommand -> PlaybackCommandEvent payload command. */
function toEventCommand(command: PlaybackCommand): {
  command: 'queue_next' | 'play' | 'pause' | 'skip';
  track: Track | null;
} {
  switch (command.type) {
    case 'queueNext':
      return { command: 'queue_next', track: command.track };
    case 'play':
      return { command: 'play', track: null };
    case 'pause':
      return { command: 'pause', track: null };
    case 'skip':
      return { command: 'skip', track: null };
    default: {
      const exhaustive: never = command;
      throw new Error(`Unknown playback command: ${JSON.stringify(exhaustive)}`);
    }
  }
}

let commandSeq = 0;
function defaultCommandId(): string {
  commandSeq += 1;
  return `cmd-${Date.now().toString(36)}-${commandSeq}`;
}

export interface RealtimePlaybackBridgeDeps {
  /** realtime/ sendToConsole: returns whether a console received the event. */
  sendToConsole: (venueId: string, event: RealtimeEvent) => boolean;
  /** Shared with the playback-state route so getNowPlaying sees reported state. */
  stateStore?: PlaybackStateStore;
  /** Override the commandId generator (tests). */
  generateCommandId?: () => string;
  /**
   * If set (>0), a command whose console never reports back is rejected after
   * this many ms so AppleMusicProvider callers don't hang forever. Default 0
   * (no timeout) — keep tests deterministic; the maintainer can enable it.
   */
  commandTimeoutMs?: number;
}

interface Pending {
  resolve: () => void;
  reject: (err: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

export class RealtimePlaybackBridge implements PlaybackBridge {
  private readonly sendToConsole: (venueId: string, event: RealtimeEvent) => boolean;
  private readonly stateStore: PlaybackStateStore;
  private readonly generateCommandId: () => string;
  private readonly commandTimeoutMs: number;
  private readonly pending = new Map<string, Pending>();

  constructor(deps: RealtimePlaybackBridgeDeps) {
    this.sendToConsole = deps.sendToConsole;
    this.stateStore = deps.stateStore ?? new PlaybackStateStore();
    this.generateCommandId = deps.generateCommandId ?? defaultCommandId;
    this.commandTimeoutMs = deps.commandTimeoutMs ?? 0;
  }

  /** The state store this bridge reads for getNowPlaying — share it with the state route. */
  get store(): PlaybackStateStore {
    return this.stateStore;
  }

  async send(target: PlaybackTarget, command: PlaybackCommand): Promise<void> {
    const commandId = this.generateCommandId();
    const { command: wireCommand, track } = toEventCommand(command);
    const event: RealtimeEvent = {
      type: 'playback_command',
      payload: { command: wireCommand, track, commandId },
    };

    const delivered = this.sendToConsole(target.venueId, event);
    if (!delivered) {
      throw new Error(`No console connection to relay playback command to venue ${target.venueId}`);
    }

    return new Promise<void>((resolve, reject) => {
      const pending: Pending = { resolve, reject };
      if (this.commandTimeoutMs > 0) {
        pending.timer = setTimeout(() => {
          this.pending.delete(commandId);
          reject(new Error(`Playback command ${commandId} timed out awaiting console report`));
        }, this.commandTimeoutMs);
        pending.timer.unref?.();
      }
      this.pending.set(commandId, pending);
    });
  }

  async getNowPlaying(target: PlaybackTarget): Promise<NowPlayingState> {
    return this.stateStore.getNowPlaying(target.venueId);
  }

  /**
   * Resolve the pending send() whose commandId the console echoed back in its
   * state report. Returns whether a pending command matched. Wire this from the
   * playback-state route.
   */
  resolveCommand(commandId: string): boolean {
    const pending = this.pending.get(commandId);
    if (!pending) return false;
    if (pending.timer) clearTimeout(pending.timer);
    this.pending.delete(commandId);
    pending.resolve();
    return true;
  }

  /** Number of commands awaiting a console report (introspection/tests). */
  pendingCount(): number {
    return this.pending.size;
  }
}
