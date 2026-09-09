/**
 * Real Sign in with Google / Apple verification (SPEC.md §2, §5 "User sign-in").
 *
 * Both providers are OIDC issuers, so one JWKS-backed verifier covers them: the
 * client obtains an ID token (Google Identity Services, Sign in with Apple) and
 * sends it as `JoinSessionRequest.authToken`; we verify it here and map it onto
 * the existing `VerifiedIdentity` seam.
 *
 * Security notes — every one of these is load-bearing:
 *  - The signature is checked against the provider's published JWKS, fetched and
 *    cached by `jose` (which also handles key rotation). We never trust a token's
 *    contents before that check.
 *  - `issuer` and `audience` are both pinned. Skipping the audience check is the
 *    classic ID-token vulnerability: a token minted for a DIFFERENT app is still
 *    validly signed by Google, so without it anyone could sign in as anyone.
 *  - Expiry/not-before are enforced by `jose` by default.
 *  - A provider with no configured client id is treated as DISABLED and rejected,
 *    so a misconfigured deploy fails closed rather than accepting unverifiable
 *    tokens.
 *
 * The unverified `iss` claim is read only to choose which verifier to run; the
 * chosen verifier then re-checks `iss` cryptographically, so a forged `iss`
 * cannot select a weaker path — it just fails.
 */
import { createRemoteJWKSet, decodeJwt, jwtVerify, type JWTPayload } from 'jose';
import { AuthVerificationError, type AuthVerifier, type VerifiedIdentity } from './auth.js';

type OidcProvider = Extract<VerifiedIdentity['provider'], 'google' | 'apple'>;

interface ProviderConfig {
  provider: OidcProvider;
  /** Accepted `iss` values (Google historically mints both spellings). */
  issuers: string[];
  jwksUri: string;
  /** OAuth client id / Services ID this deployment accepts tokens for. */
  audience: string;
}

export interface OidcVerifierOptions {
  googleClientId?: string;
  appleClientId?: string;
  /** Test seam: swap the JWKS resolver so tests never hit the network. */
  jwksFactory?: (uri: string) => ReturnType<typeof createRemoteJWKSet>;
}

const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const GOOGLE_JWKS = 'https://www.googleapis.com/oauth2/v3/certs';
const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_JWKS = 'https://appleid.apple.com/auth/keys';

/**
 * Best-effort human name. Google supplies `name`; Apple only returns a name to
 * the CLIENT on first authorization and never in the ID token, so Apple users
 * fall back to the email local-part and finally to a generic label. Display
 * names are cosmetic — identity is always the verified `sub`.
 */
function displayNameFrom(payload: JWTPayload, provider: OidcProvider): string {
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  if (name) return name;
  const email = typeof payload.email === 'string' ? payload.email : '';
  const local = email.split('@')[0]?.trim();
  if (local) return local;
  return provider === 'apple' ? 'Apple User' : 'Google User';
}

/** Reads `iss` WITHOUT verifying, purely to route to the right verifier. */
function unverifiedIssuer(token: string): string | null {
  try {
    const { iss } = decodeJwt(token);
    return typeof iss === 'string' ? iss : null;
  } catch {
    return null;
  }
}

/**
 * Builds an AuthVerifier for whichever providers are configured. Providers
 * without a client id stay disabled and their tokens are rejected.
 */
export function createOidcAuthVerifier(options: OidcVerifierOptions = {}): AuthVerifier {
  const googleClientId = options.googleClientId ?? process.env.GOOGLE_CLIENT_ID;
  const appleClientId = options.appleClientId ?? process.env.APPLE_CLIENT_ID;
  const makeJwks = options.jwksFactory ?? ((uri: string) => createRemoteJWKSet(new URL(uri)));

  const configs: ProviderConfig[] = [];
  if (googleClientId) {
    configs.push({
      provider: 'google',
      issuers: GOOGLE_ISSUERS,
      jwksUri: GOOGLE_JWKS,
      audience: googleClientId,
    });
  }
  if (appleClientId) {
    configs.push({
      provider: 'apple',
      issuers: [APPLE_ISSUER],
      jwksUri: APPLE_JWKS,
      audience: appleClientId,
    });
  }

  // JWKS sets are created lazily and reused: jose caches keys and refreshes on
  // rotation, so we must not build a new set per request.
  const jwksByUri = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
  const jwksFor = (uri: string) => {
    let set = jwksByUri.get(uri);
    if (!set) {
      set = makeJwks(uri);
      jwksByUri.set(uri, set);
    }
    return set;
  };

  return {
    async verify(authToken: string): Promise<VerifiedIdentity> {
      if (configs.length === 0) {
        throw new AuthVerificationError(
          'No sign-in provider is configured (set GOOGLE_CLIENT_ID and/or APPLE_CLIENT_ID).',
        );
      }
      const token = authToken.trim();
      if (!token) throw new AuthVerificationError('Empty auth token.');

      const iss = unverifiedIssuer(token);
      const config = configs.find((c) => iss !== null && c.issuers.includes(iss));
      if (!config) {
        throw new AuthVerificationError(
          'Auth token is not from a configured sign-in provider.',
        );
      }

      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(token, jwksFor(config.jwksUri), {
          issuer: config.issuers,
          audience: config.audience,
        }));
      } catch (err) {
        // Never leak provider internals to the caller; the reason is logged upstream.
        throw new AuthVerificationError(
          `Could not verify ${config.provider} sign-in token: ${(err as Error).message}`,
        );
      }

      const subject = typeof payload.sub === 'string' ? payload.sub : '';
      if (!subject) {
        throw new AuthVerificationError('Verified token is missing a subject claim.');
      }

      // Google marks unverified emails; refuse them so an unverified address can
      // never be used to imply an identity downstream.
      if (payload.email !== undefined && payload.email_verified === false) {
        throw new AuthVerificationError('Sign-in provider reports the email is not verified.');
      }

      return {
        provider: config.provider,
        subject,
        displayName: displayNameFrom(payload, config.provider),
      };
    },
  };
}
