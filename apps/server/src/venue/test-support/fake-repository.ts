import { randomUUID } from 'node:crypto';
import type {
  MusicProviderId,
  PlayabilityState,
  QueueItem,
  QueueItemId,
  QueueItemSourceType,
  QueueItemStatus,
  Track,
  UserId,
  VenueId,
  VenueSummary,
} from '@openaux/shared';
import { powerHourStateAt } from '../power-hour-logic.js';
import type {
  AnthemConfig,
  PowerHourRecord,
  VenueRepository,
  VenueSettingsRecord,
} from '../types.js';

/** In-memory VenueRepository for tests — no live DB required. */
export class FakeVenueRepository implements VenueRepository {
  settings = new Map<VenueId, VenueSettingsRecord>();
  musicProviders = new Map<VenueId, MusicProviderId>();
  queueItems = new Map<QueueItemId, QueueItem>();
  anthems = new Map<VenueId, AnthemConfig>();
  fallbackPlaylists = new Map<VenueId, string[]>();
  displayNames = new Map<UserId, string>();
  venueActors = new Map<VenueId, UserId>();
  powerHours = new Map<VenueId, PowerHourRecord>();

  seedVenue(
    venueId: VenueId,
    opts: Partial<VenueSettingsRecord & { musicProvider: MusicProviderId }> = {},
  ): void {
    this.settings.set(venueId, {
      venueId,
      controlMode: opts.controlMode ?? 'crowd',
      blockExplicit: opts.blockExplicit ?? false,
      blockedGenres: opts.blockedGenres ?? [],
      blockedArtists: opts.blockedArtists ?? [],
    });
    this.musicProviders.set(venueId, opts.musicProvider ?? 'spotify');
  }

  seedQueueItem(item: QueueItem): void {
    this.queueItems.set(item.queueItemId, item);
  }

  async getSettings(venueId: VenueId): Promise<VenueSettingsRecord | null> {
    return this.settings.get(venueId) ?? null;
  }

  async updateSettings(
    venueId: VenueId,
    patch: Partial<Omit<VenueSettingsRecord, 'venueId'>>,
  ): Promise<VenueSettingsRecord | null> {
    const current = this.settings.get(venueId);
    if (!current) return null;
    const updated = { ...current, ...patch };
    this.settings.set(venueId, updated);
    return updated;
  }

  async getVenueSummary(venueId: VenueId): Promise<VenueSummary | null> {
    const settings = this.settings.get(venueId);
    if (!settings) return null;
    const record = this.powerHours.get(venueId) ?? null;
    return {
      venueId,
      name: 'Test Venue',
      musicProvider: 'spotify',
      controlMode: settings.controlMode,
      qrToken: `qr-${venueId}`,
      blockExplicit: settings.blockExplicit,
      blockedGenres: settings.blockedGenres,
      blockedArtists: settings.blockedArtists,
      powerHour: record ? powerHourStateAt(record, new Date()) : null,
    };
  }

  async getFallbackPlaylist(venueId: VenueId): Promise<string[]> {
    return this.fallbackPlaylists.get(venueId) ?? [];
  }

  async getMusicProviderId(venueId: VenueId): Promise<MusicProviderId | null> {
    return this.musicProviders.get(venueId) ?? null;
  }

  async getOrCreateVenueActorUserId(venueId: VenueId): Promise<UserId> {
    let userId = this.venueActors.get(venueId);
    if (!userId) {
      userId = randomUUID();
      this.venueActors.set(venueId, userId);
      this.displayNames.set(userId, 'Venue');
    }
    return userId;
  }

  async insertQueueItem(input: {
    venueId: VenueId;
    track: Track;
    requestingUserId: UserId;
    sourceType: QueueItemSourceType;
    playabilityState: PlayabilityState;
  }): Promise<QueueItem> {
    const item: QueueItem = {
      queueItemId: randomUUID(),
      venueId: input.venueId,
      songId: input.track.providerTrackId,
      provider: input.track.provider,
      requestingUserId: input.requestingUserId,
      createdAt: new Date(),
      status: 'queued',
      upvotesCount: 0,
      downvotesCount: 0,
      uniqueSupporterCount: 0,
      priorityBoostCount: 0,
      instantVoteCount: 0,
      superBoostCount: 0,
      explicitFlag: input.track.explicit,
      genre: input.track.genres[0] ?? null,
      artist: input.track.artist,
      title: input.track.title,
      isDuplicateLocked: false,
      lastScoreCalculatedAt: null,
      currentScore: 0,
      playabilityState: input.playabilityState,
      playabilityReason: null,
      sourceType: input.sourceType,
      playedAt: null,
      crowdSkipVotes: 0,
    };
    this.queueItems.set(item.queueItemId, item);
    return item;
  }

  async getQueueItem(queueItemId: QueueItemId): Promise<QueueItem | null> {
    return this.queueItems.get(queueItemId) ?? null;
  }

  async setPlayabilityState(
    queueItemId: QueueItemId,
    state: PlayabilityState,
  ): Promise<QueueItem | null> {
    const item = this.queueItems.get(queueItemId);
    if (!item) return null;
    const updated = { ...item, playabilityState: state };
    this.queueItems.set(queueItemId, updated);
    return updated;
  }

  async setStatus(queueItemId: QueueItemId, status: QueueItemStatus): Promise<QueueItem | null> {
    const item = this.queueItems.get(queueItemId);
    if (!item) return null;
    const updated = { ...item, status };
    this.queueItems.set(queueItemId, updated);
    return updated;
  }

  async getCurrentlyPlaying(venueId: VenueId): Promise<QueueItem | null> {
    for (const item of this.queueItems.values()) {
      if (item.venueId === venueId && item.status === 'playing') return item;
    }
    return null;
  }

  async setFallbackPlaylist(venueId: VenueId, providerTrackIds: string[]): Promise<void> {
    this.fallbackPlaylists.set(venueId, providerTrackIds);
  }

  async setAnthem(venueId: VenueId, anthem: AnthemConfig): Promise<void> {
    this.anthems.set(venueId, anthem);
  }

  async getAnthem(venueId: VenueId): Promise<AnthemConfig | null> {
    return this.anthems.get(venueId) ?? null;
  }

  async setPowerHour(venueId: VenueId, record: PowerHourRecord): Promise<void> {
    this.powerHours.set(venueId, record);
  }

  async getPowerHour(venueId: VenueId): Promise<PowerHourRecord | null> {
    return this.powerHours.get(venueId) ?? null;
  }

  async clearPowerHour(venueId: VenueId): Promise<void> {
    this.powerHours.delete(venueId);
  }

  async getUserDisplayName(userId: UserId): Promise<string | null> {
    return this.displayNames.get(userId) ?? null;
  }
}
