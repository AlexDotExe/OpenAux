/**
 * In-memory VenueAuthRepository for unit tests — no live database.
 */
import { randomUUID } from 'node:crypto';
import type { MusicProviderId, VenueOwner, VenueSummary } from '@openaux/shared';
import {
  DuplicateEmailError,
  type OwnerWithSecret,
  type SessionRecord,
  type VenueAuthRepository,
} from '../repository.js';

interface StoredOwner extends VenueOwner {
  passwordHash: string;
}

export class InMemoryVenueAuthRepository implements VenueAuthRepository {
  private owners = new Map<string, StoredOwner>();
  private sessions = new Map<string, SessionRecord>();
  private venues = new Map<string, VenueSummary & { ownerId: string }>();

  async createOwner(email: string, passwordHash: string, displayName: string): Promise<VenueOwner> {
    const normalized = email.toLowerCase();
    for (const o of this.owners.values()) {
      if (o.email === normalized) throw new DuplicateEmailError('email already registered');
    }
    const owner: StoredOwner = {
      venueOwnerId: randomUUID(),
      email: normalized,
      displayName,
      createdAt: new Date(),
      passwordHash,
    };
    this.owners.set(owner.venueOwnerId, owner);
    return this.publicOwner(owner);
  }

  async findOwnerByEmail(email: string): Promise<OwnerWithSecret | null> {
    const normalized = email.toLowerCase();
    for (const o of this.owners.values()) {
      if (o.email === normalized)
        return { owner: this.publicOwner(o), passwordHash: o.passwordHash };
    }
    return null;
  }

  async findOwnerById(venueOwnerId: string): Promise<VenueOwner | null> {
    const o = this.owners.get(venueOwnerId);
    return o ? this.publicOwner(o) : null;
  }

  async createSession(tokenHash: string, venueOwnerId: string, expiresAt: Date): Promise<void> {
    this.sessions.set(tokenHash, { venueOwnerId, expiresAt });
  }

  async findSession(tokenHash: string): Promise<SessionRecord | null> {
    return this.sessions.get(tokenHash) ?? null;
  }

  async touchSession(): Promise<void> {
    // no-op in tests
  }

  async createVenue(
    ownerId: string,
    name: string,
    musicProvider: MusicProviderId,
    qrToken: string,
  ): Promise<VenueSummary> {
    const venue: VenueSummary & { ownerId: string } = {
      venueId: randomUUID(),
      ownerId,
      name,
      musicProvider,
      controlMode: 'crowd',
      qrToken,
      blockExplicit: false,
      blockedGenres: [],
      blockedArtists: [],
    };
    this.venues.set(venue.venueId, venue);
    return this.summary(venue);
  }

  async listVenuesByOwner(ownerId: string): Promise<VenueSummary[]> {
    return [...this.venues.values()]
      .filter((v) => v.ownerId === ownerId)
      .map((v) => this.summary(v));
  }

  async ownerOwnsVenue(ownerId: string, venueId: string): Promise<boolean> {
    return this.venues.get(venueId)?.ownerId === ownerId;
  }

  private publicOwner(o: StoredOwner): StoredOwner {
    return { ...o };
  }

  private summary(v: VenueSummary & { ownerId: string }): VenueSummary {
    return {
      venueId: v.venueId,
      name: v.name,
      musicProvider: v.musicProvider,
      controlMode: v.controlMode,
      qrToken: v.qrToken,
      blockExplicit: v.blockExplicit,
      blockedGenres: v.blockedGenres,
      blockedArtists: v.blockedArtists,
    };
  }
}
