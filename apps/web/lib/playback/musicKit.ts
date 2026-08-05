/**
 * Apple-side playback glue for the venue console. MusicKit JS runs in the
 * venue operator's own browser and is the only thing that can actually play
 * audio for an Apple Music venue (there is no server-side Apple playback API).
 *
 * The two pieces the panel relies on — turning an incoming PlaybackCommandEvent
 * into MusicKit calls, and turning MusicKit's state into a
 * ReportPlaybackStateRequest — are pure and live here so they can be unit tested
 * with a fake MusicKit object (no CDN, no DOM). loadMusicKit() is the only
 * side-effectful, browser-only bit and is not exercised in tests.
 */

import type { PlaybackCommandEvent, ReportPlaybackStateRequest } from '@openaux/shared';

/**
 * The slice of a MusicKit v3 instance the console uses. Kept minimal and
 * structural so tests can pass a plain fake. See Apple's MusicKit JS docs for
 * the full surface.
 */
export interface MusicKitInstance {
  setQueue(options: { song?: string; songs?: string[] }): Promise<unknown>;
  play(): Promise<unknown>;
  pause(): Promise<unknown> | void;
  skipToNextItem(): Promise<unknown>;
  readonly isPlaying: boolean;
  /** Playback position in SECONDS (MusicKit's unit). */
  readonly currentPlaybackTime: number;
  readonly nowPlayingItem: { id: string } | null;
  addEventListener?(name: string, handler: () => void): void;
  removeEventListener?(name: string, handler: () => void): void;
}

/** Execute an incoming playback_command against the venue's MusicKit session. */
export async function executePlaybackCommand(
  instance: MusicKitInstance,
  payload: PlaybackCommandEvent['payload'],
): Promise<void> {
  switch (payload.command) {
    case 'queue_next':
      if (payload.track) {
        await instance.setQueue({ song: payload.track.providerTrackId });
        await instance.play();
      }
      return;
    case 'play':
      await instance.play();
      return;
    case 'pause':
      await instance.pause();
      return;
    case 'skip':
      await instance.skipToNextItem();
      return;
    default: {
      const exhaustive: never = payload.command;
      throw new Error(`Unknown playback command: ${String(exhaustive)}`);
    }
  }
}

export interface StateReportOptions {
  /** Echo the commandId from the playback_command this report responds to. */
  commandId?: string;
  /** Mark the current track as finished so the server advances the queue. */
  trackEnded?: boolean;
}

/** Snapshot MusicKit's current playback into the REST state-report shape. */
export function buildStateReport(
  instance: MusicKitInstance,
  opts: StateReportOptions = {},
): ReportPlaybackStateRequest {
  const report: ReportPlaybackStateRequest = {
    isPlaying: instance.isPlaying,
    positionMs: Math.max(0, Math.round((instance.currentPlaybackTime ?? 0) * 1000)),
    providerTrackId: instance.nowPlayingItem?.id ?? null,
  };
  if (opts.trackEnded) report.trackEnded = true;
  if (opts.commandId) report.commandId = opts.commandId;
  return report;
}

// ---------------------------------------------------------------------------
// Browser-only bootstrap (not unit tested — no CDN in tests).
// ---------------------------------------------------------------------------

const MUSICKIT_CDN = 'https://js-cdn.music.apple.com/musickit/v3/musickit.js';

interface MusicKitGlobal {
  configure(options: {
    developerToken: string;
    app: { name: string; build: string };
  }): Promise<MusicKitInstance> | MusicKitInstance;
}

declare global {
  interface Window {
    MusicKit?: MusicKitGlobal;
  }
}

/**
 * Where the Apple developer token comes from. Documented seam: the console
 * needs a signed MusicKit developer token, which must NOT be a client secret
 * baked into the bundle in production. Two options, in order:
 *   1. NEXT_PUBLIC_APPLE_DEVELOPER_TOKEN — a token injected at build time
 *      (fine for dev/demo; rotates with the deploy).
 *   2. NEXT_PUBLIC_APPLE_DEVELOPER_TOKEN_ENDPOINT — a URL the console GETs to
 *      fetch a fresh token from a server that holds the AuthKey private key.
 * TODO(maintainer): stand up the token endpoint; the server side belongs to
 * the providers/Apple workstream, not this one.
 */
export function getAppleDeveloperTokenConfig(): { inline: string | null; endpoint: string | null } {
  return {
    inline: process.env.NEXT_PUBLIC_APPLE_DEVELOPER_TOKEN ?? null,
    endpoint: process.env.NEXT_PUBLIC_APPLE_DEVELOPER_TOKEN_ENDPOINT ?? null,
  };
}

/** Fetch the developer token per the seam above. Returns null when unconfigured/unreachable. */
export async function fetchAppleDeveloperToken(): Promise<string | null> {
  const { inline, endpoint } = getAppleDeveloperTokenConfig();
  if (inline) return inline;
  if (!endpoint) return null;
  try {
    const res = await fetch(endpoint);
    if (!res.ok) return null;
    const text = await res.text();
    try {
      const json = JSON.parse(text) as { developerToken?: string };
      return json.developerToken ?? (text || null);
    } catch {
      return text || null;
    }
  } catch {
    return null;
  }
}

let scriptPromise: Promise<void> | null = null;

function loadMusicKitScript(): Promise<void> {
  if (typeof document === 'undefined') return Promise.reject(new Error('no document'));
  if (window.MusicKit) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = MUSICKIT_CDN;
    script.async = true;
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () => reject(new Error('MusicKit script failed to load')));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

/**
 * Load MusicKit JS from Apple's CDN (allowed — this is the app's own page, not
 * a Claude artifact) and configure it with a developer token. Returns a
 * configured instance, or null if MusicKit is unavailable for any reason so the
 * caller can render a clean "MusicKit unavailable" state.
 */
export async function loadMusicKit(): Promise<MusicKitInstance | null> {
  if (typeof window === 'undefined') return null;
  const developerToken = await fetchAppleDeveloperToken();
  if (!developerToken) return null;
  try {
    await loadMusicKitScript();
    const MusicKit = window.MusicKit;
    if (!MusicKit) return null;
    return await MusicKit.configure({
      developerToken,
      app: { name: 'OpenAux Venue Console', build: '0.0.1' },
    });
  } catch {
    return null;
  }
}
