import { generateKeyPairSync, verify as cryptoVerify } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppleDeveloperTokenProvider } from './developer-token.js';

const { privateKey, publicKey } = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

function decodeJwt(token: string): {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
} {
  const [headerB64, payloadB64] = token.split('.');
  const decode = (b64url: string) => JSON.parse(Buffer.from(b64url, 'base64url').toString('utf8'));
  return { header: decode(headerB64 as string), payload: decode(payloadB64 as string) };
}

function verifyJwtSignature(token: string): boolean {
  const [headerB64, payloadB64, sigB64] = token.split('.');
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = Buffer.from(sigB64 as string, 'base64url');
  return cryptoVerify(
    'sha256',
    Buffer.from(signingInput),
    { key: publicKey, dsaEncoding: 'ieee-p1363' },
    signature,
  );
}

describe('AppleDeveloperTokenProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('mints a valid ES256 JWT with the configured team/key ids', () => {
    const provider = new AppleDeveloperTokenProvider({
      teamId: 'TEAM123',
      keyId: 'KEY456',
      privateKey,
    });

    const token = provider.getToken();
    const { header, payload } = decodeJwt(token);

    expect(header).toEqual({ alg: 'ES256', kid: 'KEY456' });
    expect(payload.iss).toBe('TEAM123');
    expect(typeof payload.iat).toBe('number');
    expect(typeof payload.exp).toBe('number');
    expect(verifyJwtSignature(token)).toBe(true);
  });

  it('caches the token across calls', () => {
    const provider = new AppleDeveloperTokenProvider({ teamId: 'T', keyId: 'K', privateKey });

    const first = provider.getToken();
    const second = provider.getToken();

    expect(second).toBe(first);
  });

  it('mints a new token once the cached one nears its declared expiry', () => {
    const provider = new AppleDeveloperTokenProvider({
      teamId: 'T',
      keyId: 'K',
      privateKey,
      ttlSeconds: 3600,
    });

    const first = provider.getToken();
    vi.advanceTimersByTime(3600 * 1000);
    const second = provider.getToken();

    expect(second).not.toBe(first);
    expect(verifyJwtSignature(second)).toBe(true);
  });

  it('refresh() mints a new token even if the cached one is still valid', () => {
    const provider = new AppleDeveloperTokenProvider({ teamId: 'T', keyId: 'K', privateKey });

    const first = provider.getToken();
    const refreshed = provider.refresh();

    expect(refreshed).not.toBe(first);
    expect(verifyJwtSignature(refreshed)).toBe(true);
  });
});
