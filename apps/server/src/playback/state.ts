// playback — playback loop server side (console command relay + state reports + end-of-track).
// NEW folder; see CLAUDE.md ownership map. Depends only on @openaux/shared and the
// realtime/ + providers/ public seams — never on other server workstream internals.

/**
 * In-memory, per-venue "now playing" cache. Written by the playback-state
 * report route (what the console/poller last told us) and read by
 * RealtimePlaybackBridge.getNowPlaying (what AppleMusicProvider.getNowPlaying
 * resolves to). Not durable — a restart drops it; the console re-reports on
 * its next state push.
 */
import type { NowPlayingState, VenueId } from '@openaux/shared';

const SILENCE: NowPlayingState = { track: null, positionMs: 0, isPlaying: false };

/** What the console/poller reports; a subset of a full Track (only the id survives the contract). */
export interface PlaybackSnapshot {
  providerTrackId: string | null;
  positionMs: number;
  isPlaying: boolean;
}

export class PlaybackStateStore {
  private readonly byVenue = new Map<VenueId, PlaybackSnapshot>();

  record(venueId: VenueId, snapshot: PlaybackSnapshot): void {
    this.byVenue.set(venueId, { ...snapshot });
  }

  getSnapshot(venueId: VenueId): PlaybackSnapshot | null {
    return this.byVenue.get(venueId) ?? null;
  }

  /**
   * Adapt the last snapshot to a MusicProvider NowPlayingState. Only
   * providerTrackId is authoritative — the state-report contract
   * (ReportPlaybackStateRequest) carries no track metadata, so title/artist/etc.
   * are placeholders. Consumers that need full metadata must look the track up
   * via the provider catalog. Track ended detection for Apple venues rides the
   * REST `trackEnded` flag, not this reconstruction.
   */
  getNowPlaying(venueId: VenueId): NowPlayingState {
    const snapshot = this.byVenue.get(venueId);
    if (!snapshot) return { ...SILENCE };
    return {
      track: snapshot.providerTrackId
        ? {
            provider: 'apple_music',
            providerTrackId: snapshot.providerTrackId,
            title: '',
            artist: '',
            album: null,
            durationMs: 0,
            explicit: false,
            genres: [],
            artworkUrl: null,
          }
        : null,
      positionMs: snapshot.positionMs,
      isPlaying: snapshot.isPlaying,
    };
  }
}
