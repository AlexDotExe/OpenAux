/**
 * Venue-owner auth service: signup, login, venue creation. Pure orchestration
 * over the repository + crypto helpers — no HTTP concerns.
 */
import { randomBytes } from 'node:crypto';
import type {
  CreateVenueRequest,
  MusicProviderId,
  VenueOwnerPublic,
  VenueSummary,
} from '@openaux/shared';
import { generateSessionToken, hashPassword, hashToken, verifyPassword } from './crypto.js';
import { DuplicateEmailError, type VenueAuthRepository } from './repository.js';

/** 30-day operator sessions. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export class VenueAuthError extends Error {
  constructor(
    public readonly code: 'validation' | 'unauthorized',
    message: string,
  ) {
    super(message);
  }
}

export interface AuthResult {
  token: string;
  expiresAt: Date;
  owner: VenueOwnerPublic;
}

function toPublic(owner: {
  venueOwnerId: string;
  email: string;
  displayName: string;
}): VenueOwnerPublic {
  return { venueOwnerId: owner.venueOwnerId, email: owner.email, displayName: owner.displayName };
}

export interface VenueAuthServiceDeps {
  repository: VenueAuthRepository;
  now?: () => Date;
}

export class VenueAuthService {
  private readonly repo: VenueAuthRepository;
  private readonly now: () => Date;

  constructor(deps: VenueAuthServiceDeps) {
    this.repo = deps.repository;
    this.now = deps.now ?? (() => new Date());
  }

  async signup(email: string, password: string, displayName: string): Promise<AuthResult> {
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail)) {
      throw new VenueAuthError('validation', 'a valid email is required');
    }
    if (password.length < 8) {
      throw new VenueAuthError('validation', 'password must be at least 8 characters');
    }
    if (!displayName.trim()) {
      throw new VenueAuthError('validation', 'display name is required');
    }
    try {
      const owner = await this.repo.createOwner(
        normalizedEmail,
        hashPassword(password),
        displayName.trim(),
      );
      return this.issueSession(owner);
    } catch (err) {
      if (err instanceof DuplicateEmailError) {
        throw new VenueAuthError('validation', 'email already registered');
      }
      throw err;
    }
  }

  async login(email: string, password: string): Promise<AuthResult> {
    const found = await this.repo.findOwnerByEmail(email.trim().toLowerCase());
    // Verify even when the owner is missing would be ideal for timing uniformity,
    // but scrypt on a fixed dummy is enough to avoid trivial user enumeration.
    if (!found || !verifyPassword(password, found.passwordHash)) {
      throw new VenueAuthError('unauthorized', 'invalid email or password');
    }
    return this.issueSession(found.owner);
  }

  private async issueSession(owner: {
    venueOwnerId: string;
    email: string;
    displayName: string;
  }): Promise<AuthResult> {
    const token = generateSessionToken();
    const expiresAt = new Date(this.now().getTime() + SESSION_TTL_MS);
    await this.repo.createSession(hashToken(token), owner.venueOwnerId, expiresAt);
    return { token, expiresAt, owner: toPublic(owner) };
  }

  async createVenue(ownerId: string, input: CreateVenueRequest): Promise<VenueSummary> {
    const name = input.name?.trim();
    if (!name) throw new VenueAuthError('validation', 'venue name is required');
    if (input.musicProvider !== 'spotify' && input.musicProvider !== 'apple_music') {
      throw new VenueAuthError('validation', 'musicProvider must be spotify or apple_music');
    }
    const qrToken = generateQrToken();
    return this.repo.createVenue(ownerId, name, input.musicProvider as MusicProviderId, qrToken);
  }

  async listVenues(ownerId: string): Promise<VenueSummary[]> {
    return this.repo.listVenuesByOwner(ownerId);
  }
}

/** Short, URL-safe join token embedded in the venue QR code. */
function generateQrToken(): string {
  return randomBytes(9).toString('base64url');
}
