/**
 * Sign-in verification tests.
 *
 * Tokens are signed with a locally generated RS256 key and the JWKS resolver is
 * swapped for a local key set, so nothing touches Google/Apple over the network.
 * The negative cases are the point: each one is a way a naive implementation
 * would let an attacker in.
 */
import { describe, expect, it } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet, type JWK } from 'jose';
import { createOidcAuthVerifier } from './oidc-verifier.js';
import { AuthVerificationError } from './auth.js';

const GOOGLE_ISS = 'https://accounts.google.com';
const APPLE_ISS = 'https://appleid.apple.com';
const GOOGLE_AUD = 'google-client-id.apps.googleusercontent.com';
const APPLE_AUD = 'com.openaux.services';

async function keyMaterial() {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  const jwk = (await exportJWK(publicKey)) as JWK;
  jwk.kid = 'test-key';
  jwk.alg = 'RS256';
  return { privateKey, jwks: createLocalJWKSet({ keys: [jwk] }) };
}

type PrivateKey = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

async function signToken(
  privateKey: PrivateKey,
  claims: Record<string, unknown>,
  opts: { issuer: string; audience: string; expSeconds?: number },
) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(opts.issuer)
    .setAudience(opts.audience)
    .setIssuedAt()
    .setExpirationTime(opts.expSeconds ?? Math.floor(Date.now() / 1000) + 3600)
    .sign(privateKey);
}

async function build() {
  const { privateKey, jwks } = await keyMaterial();
  const verifier = createOidcAuthVerifier({
    googleClientId: GOOGLE_AUD,
    appleClientId: APPLE_AUD,
    jwksFactory: () => jwks as never,
  });
  return { privateKey, verifier };
}

describe('createOidcAuthVerifier — happy paths', () => {
  it('verifies a Google ID token and maps it to an identity', async () => {
    const { privateKey, verifier } = await build();
    const token = await signToken(
      privateKey,
      { sub: 'google-sub-1', name: 'Ada Lovelace', email: 'ada@example.com', email_verified: true },
      { issuer: GOOGLE_ISS, audience: GOOGLE_AUD },
    );

    await expect(verifier.verify(token)).resolves.toEqual({
      provider: 'google',
      subject: 'google-sub-1',
      displayName: 'Ada Lovelace',
    });
  });

  it('verifies an Apple token and falls back to the email local-part for a name', async () => {
    const { privateKey, verifier } = await build();
    // Apple omits `name` from the ID token — it is only returned to the client
    // on first authorization — so the fallback matters in practice.
    const token = await signToken(
      privateKey,
      { sub: 'apple-sub-1', email: 'grace@example.com', email_verified: true },
      { issuer: APPLE_ISS, audience: APPLE_AUD },
    );

    await expect(verifier.verify(token)).resolves.toEqual({
      provider: 'apple',
      subject: 'apple-sub-1',
      displayName: 'grace',
    });
  });

  it('accepts the bare accounts.google.com issuer spelling', async () => {
    const { privateKey, verifier } = await build();
    const token = await signToken(
      privateKey,
      { sub: 'google-sub-2', name: 'Alan' },
      { issuer: 'accounts.google.com', audience: GOOGLE_AUD },
    );
    await expect(verifier.verify(token)).resolves.toMatchObject({ provider: 'google' });
  });
});

describe('createOidcAuthVerifier — rejections', () => {
  it('rejects a token minted for a DIFFERENT audience', async () => {
    // The critical case: this token is genuinely signed by the provider, just
    // issued to another app. Without an audience check it would be accepted.
    const { privateKey, verifier } = await build();
    const token = await signToken(
      privateKey,
      { sub: 'attacker' },
      { issuer: GOOGLE_ISS, audience: 'some-other-app.apps.googleusercontent.com' },
    );
    await expect(verifier.verify(token)).rejects.toBeInstanceOf(AuthVerificationError);
  });

  it('rejects a token signed by an unknown key', async () => {
    const { verifier } = await build();
    const other = await keyMaterial(); // different signing key
    const token = await signToken(
      other.privateKey,
      { sub: 'forged' },
      { issuer: GOOGLE_ISS, audience: GOOGLE_AUD },
    );
    await expect(verifier.verify(token)).rejects.toBeInstanceOf(AuthVerificationError);
  });

  it('rejects an expired token', async () => {
    const { privateKey, verifier } = await build();
    const token = await signToken(
      privateKey,
      { sub: 'stale' },
      {
        issuer: GOOGLE_ISS,
        audience: GOOGLE_AUD,
        expSeconds: Math.floor(Date.now() / 1000) - 60,
      },
    );
    await expect(verifier.verify(token)).rejects.toBeInstanceOf(AuthVerificationError);
  });

  it('rejects an unconfigured provider rather than trusting it', async () => {
    const { privateKey } = await build();
    const { jwks } = await keyMaterial();
    // Only Google configured; an Apple token must not be accepted.
    const googleOnly = createOidcAuthVerifier({
      googleClientId: GOOGLE_AUD,
      jwksFactory: () => jwks as never,
    });
    const token = await signToken(
      privateKey,
      { sub: 'apple-sub' },
      { issuer: APPLE_ISS, audience: APPLE_AUD },
    );
    await expect(googleOnly.verify(token)).rejects.toBeInstanceOf(AuthVerificationError);
  });

  it('fails closed when no provider is configured at all', async () => {
    const none = createOidcAuthVerifier({ googleClientId: undefined, appleClientId: undefined });
    await expect(none.verify('anything')).rejects.toBeInstanceOf(AuthVerificationError);
  });

  it('rejects garbage and empty tokens', async () => {
    const { verifier } = await build();
    await expect(verifier.verify('not-a-jwt')).rejects.toBeInstanceOf(AuthVerificationError);
    await expect(verifier.verify('   ')).rejects.toBeInstanceOf(AuthVerificationError);
  });

  it('rejects a token whose email the provider says is unverified', async () => {
    const { privateKey, verifier } = await build();
    const token = await signToken(
      privateKey,
      { sub: 'unverified', email: 'spoof@example.com', email_verified: false },
      { issuer: GOOGLE_ISS, audience: GOOGLE_AUD },
    );
    await expect(verifier.verify(token)).rejects.toBeInstanceOf(AuthVerificationError);
  });

  it('rejects a verified token with no subject claim', async () => {
    const { privateKey, verifier } = await build();
    const token = await signToken(privateKey, {}, { issuer: GOOGLE_ISS, audience: GOOGLE_AUD });
    await expect(verifier.verify(token)).rejects.toBeInstanceOf(AuthVerificationError);
  });
});
