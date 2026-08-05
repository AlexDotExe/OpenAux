/**
 * Spotify app-level token: OAuth2 client-credentials grant. This token has
 * no user context and can only call catalog endpoints (search, get track) —
 * never playback. It's cached in memory and refreshed shortly before expiry.
 */
import type { CachedToken, FetchLike } from '../types.js';

const TOKEN_URL = 'https://accounts.spotify.com/api/token';
/** Refresh this many ms before the token's reported expiry to avoid races. */
const REFRESH_SKEW_MS = 60_000;

export interface SpotifyAppTokenConfig {
  clientId: string;
  clientSecret: string;
  fetchImpl?: FetchLike;
}

export class SpotifyAppTokenProvider {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly fetchImpl: FetchLike;
  private cached: CachedToken | null = null;
  /** Coalesce concurrent refreshes into a single in-flight request. */
  private inFlight: Promise<CachedToken> | null = null;

  constructor(config: SpotifyAppTokenConfig) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async getToken(): Promise<string> {
    const now = Date.now();
    if (this.cached && this.cached.expiresAt - REFRESH_SKEW_MS > now) {
      return this.cached.token;
    }
    if (!this.inFlight) {
      this.inFlight = this.fetchToken().finally(() => {
        this.inFlight = null;
      });
    }
    const token = await this.inFlight;
    return token.token;
  }

  /** Force a refresh, discarding any cached token. Used after a 401. */
  async refresh(): Promise<string> {
    this.cached = null;
    return this.getToken();
  }

  private async fetchToken(): Promise<CachedToken> {
    const basicAuth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const res = await this.fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) {
      throw new Error(`Spotify token request failed: ${res.status} ${await safeText(res)}`);
    }
    const body = (await res.json()) as { access_token: string; expires_in: number };
    const cached: CachedToken = {
      token: body.access_token,
      expiresAt: Date.now() + body.expires_in * 1000,
    };
    this.cached = cached;
    return cached;
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
