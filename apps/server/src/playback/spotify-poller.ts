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
}

export function startSpotifyPlaybackPoller(deps: SpotifyPollerDeps): SpotifyPollerHandle {
  const intervalMs = deps.intervalMs ?? 5000;
  const onError = deps.onError ?? (() => {});
  const lastByVenue = new Map<VenueId, LastSeen>();

  async function pollVenue(venue: ActiveSpotifyVenue): Promise<void> {
    const state = await venue.provider.getNowPlaying(venue.target);
    const currentId = state.track?.providerTrackId ?? null;
    const prev = lastByVenue.get(venue.venueId);

    // A track ended if we previously saw one and now see a different track or idle.
    const trackEnded =
      prev !== undefined && prev.providerTrackId !== null && currentId !== prev.providerTrackId;

    lastByVenue.set(venue.venueId, { providerTrackId: currentId });

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
