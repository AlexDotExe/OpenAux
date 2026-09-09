/**
 * startSpotifyPlaybackPoller — end-of-track detection for Spotify Connect
 * venues. The server drives Spotify playback directly (no console/MusicKit),
 * so nothing reports track-end over REST; instead we poll each active venue's
 * MusicProvider.getNowPlaying every ~5s and detect the transition from a track
 * to a different track (or to idle), then call the same onTrackEnded the state
 * route uses (the maintainer wires it to WS3's queue advance).
 *
 * The interval is unref'd so it never keeps the process alive on its own. poll()
 * is exposed so tests can drive a single sweep without real timers.
 */
import type { MusicProvider, PlaybackTarget, VenueId } from '@openaux/shared';

/** One venue with live Spotify playback the poller should watch. */
export interface ActiveSpotifyVenue {
  venueId: VenueId;
  target: PlaybackTarget;
  provider: MusicProvider;
}

export interface SpotifyPollerDeps {
  /** Which venues currently have active Spotify playback (re-read each sweep). */
  listActiveSpotifyVenues: () => Promise<ActiveSpotifyVenue[]> | ActiveSpotifyVenue[];
  /** Called once per detected track-end/transition. Wired to WS3 queue advance. */
  onTrackEnded: (venueId: VenueId) => Promise<unknown>;
  /**
   * Called once per track, when it is within `lockLeadMs` of finishing. Wired to
   * WS3's lockNextUp: it commits the crowd's next pick and primes the device so
   * the handover is gapless instead of falling through to provider autoplay.
   */
  onTrackEnding?: (venueId: VenueId) => Promise<unknown>;
  /** How long before the end to lock the next song. Defaults to 10s. */
  lockLeadMs?: number;
  /** Per-sweep observation hook (diagnostics/telemetry). */
  onPollObserved?: (obs: {
    venueId: VenueId;
    trackId: string | null;
    isPlaying: boolean;
    remainingMs: number | null;
    locked: boolean;
  }) => void;
  /** Poll cadence; defaults to 5000ms. */
  intervalMs?: number;
  /** Non-fatal error hook — a failing venue must not stop the sweep or the loop. */
  onError?: (err: unknown, venueId?: VenueId) => void;
}

export interface SpotifyPollerHandle {
  /** Run a single sweep across all active venues now (also used by the interval). */
  poll: () => Promise<void>;
  /** Stop the interval. Idempotent. */
  stop: () => void;
}

interface LastSeen {
  providerTrackId: string | null;
  /** Whether we already locked the next song for THIS track (once per track). */
  locked: boolean;
}

export function startSpotifyPlaybackPoller(deps: SpotifyPollerDeps): SpotifyPollerHandle {
  const intervalMs = deps.intervalMs ?? 5000;
  const lockLeadMs = deps.lockLeadMs ?? 10_000;
  const onError = deps.onError ?? (() => {});
  const lastByVenue = new Map<VenueId, LastSeen>();

  async function pollVenue(venue: ActiveSpotifyVenue): Promise<void> {
    const state = await venue.provider.getNowPlaying(venue.target);
    const currentId = state.track?.providerTrackId ?? null;
    const prev = lastByVenue.get(venue.venueId);

    // A track ended if we previously saw one and now see a different track or idle.
    const trackEnded =
      prev !== undefined && prev.providerTrackId !== null && currentId !== prev.providerTrackId;

    // Carry the lock flag only while the SAME track is still playing; a new track
    // starts unlocked so we lock exactly once per song.
    const sameTrack = prev !== undefined && prev.providerTrackId === currentId;
    let locked = sameTrack ? prev.locked : false;

    // Approaching the end: commit the next pick and prime the device. Guarded on
    // isPlaying so a paused venue sitting near the end doesn't lock repeatedly.
    const durationMs = state.track?.durationMs ?? null;
    deps.onPollObserved?.({
      venueId: venue.venueId,
      trackId: currentId,
      isPlaying: state.isPlaying,
      remainingMs: durationMs === null ? null : durationMs - state.positionMs,
      locked,
    });
    if (
      !locked &&
      deps.onTrackEnding &&
      state.isPlaying &&
      currentId !== null &&
      durationMs !== null &&
      durationMs - state.positionMs <= lockLeadMs
    ) {
      locked = true;
      await deps.onTrackEnding(venue.venueId);
    }

    lastByVenue.set(venue.venueId, { providerTrackId: currentId, locked });

    if (trackEnded) {
      await deps.onTrackEnded(venue.venueId);
    }
  }

  async function poll(): Promise<void> {
    let venues: ActiveSpotifyVenue[];
    try {
      venues = await deps.listActiveSpotifyVenues();
    } catch (err) {
      onError(err);
      return;
    }
    const seen = new Set<VenueId>();
    for (const venue of venues) {
      seen.add(venue.venueId);
      try {
        await pollVenue(venue);
      } catch (err) {
        onError(err, venue.venueId);
      }
    }
    // Forget venues that are no longer active so a later re-activation starts clean.
    for (const venueId of lastByVenue.keys()) {
      if (!seen.has(venueId)) lastByVenue.delete(venueId);
    }
  }

  const timer = setInterval(() => {
    void poll();
  }, intervalMs);
  timer.unref?.();

  let stopped = false;
  return {
    poll,
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
    },
  };
}
