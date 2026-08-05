/**
 * Apple Music developer token: a self-signed ES256 JWT, not an OAuth flow.
 * Apple issues a private key (APPLE_MUSIC_PRIVATE_KEY) tied to a Team ID
 * (APPLE_MUSIC_TEAM_ID) and Key ID (APPLE_MUSIC_KEY_ID); we sign our own
 * token locally and send it as the `Authorization: Bearer <token>` header
 * for every MusicKit/Catalog API call. No network round-trip is needed to
 * mint one, so this class is a cache, not an HTTP client.
 *
 * Signed with node:crypto directly (ES256 / P-256, IEEE P1363 signature
 * encoding) so no JWT library dependency is required.
 */
import { sign as cryptoSign } from 'node:crypto';
import type { CachedToken } from '../types.js';

/** Refresh this many ms before the token's self-declared expiry. */
const REFRESH_SKEW_MS = 5 * 60_000;
/** Default token lifetime. Apple allows up to 6 months; we rotate more often. */
const DEFAULT_TTL_SECONDS = 12 * 60 * 60;

export interface AppleDeveloperTokenConfig {
  teamId: string;
  keyId: string;
  /** PEM-encoded ES256 private key (APPLE_MUSIC_PRIVATE_KEY, newlines preserved). */
  privateKey: string;
  ttlSeconds?: number;
}

export class AppleDeveloperTokenProvider {
  private readonly teamId: string;
  private readonly keyId: string;
  private readonly privateKey: string;
  private readonly ttlSeconds: number;
  private cached: CachedToken | null = null;

  constructor(config: AppleDeveloperTokenConfig) {
    this.teamId = config.teamId;
    this.keyId = config.keyId;
    this.privateKey = config.privateKey;
    this.ttlSeconds = config.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  }

  getToken(): string {
    const now = Date.now();
    if (this.cached && this.cached.expiresAt - REFRESH_SKEW_MS > now) {
      return this.cached.token;
    }
    return this.mintToken();
  }

  /** Force a fresh token, discarding the cache. Used after a 401. */
  refresh(): string {
    this.cached = null;
    return this.mintToken();
  }

  private mintToken(): string {
    const nowSec = Math.floor(Date.now() / 1000);
    const expSec = nowSec + this.ttlSeconds;
    const header = { alg: 'ES256', kid: this.keyId };
    const payload = { iss: this.teamId, iat: nowSec, exp: expSec };

    const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
    const signature = signEs256(signingInput, this.privateKey);
    const token = `${signingInput}.${signature}`;

    this.cached = { token, expiresAt: expSec * 1000 };
    return token;
  }
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function signEs256(signingInput: string, privateKeyPem: string): string {
  // dsaEncoding 'ieee-p1363' produces the raw r||s format JWS requires,
  // instead of Node's default ASN.1/DER encoding.
  const signature = cryptoSign('sha256', Buffer.from(signingInput), {
    key: privateKeyPem,
    dsaEncoding: 'ieee-p1363',
  });
  return base64url(signature);
}
