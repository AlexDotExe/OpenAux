import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { TokenCipher, loadEncryptionKey } from './crypto.js';

const KEY = randomBytes(32);

describe('TokenCipher', () => {
  it('roundtrips plaintext through encrypt/decrypt', () => {
    const cipher = new TokenCipher(KEY);
    const secret = 'BQD-refresh-token-value_123';
    const encrypted = cipher.encrypt(secret);

    expect(encrypted).not.toContain(secret);
    expect(cipher.decrypt(encrypted)).toBe(secret);
  });

  it('produces a distinct ciphertext each time (random IV) but decrypts to the same value', () => {
    const cipher = new TokenCipher(KEY);
    const a = cipher.encrypt('same');
    const b = cipher.encrypt('same');

    expect(a).not.toBe(b);
    expect(cipher.decrypt(a)).toBe('same');
    expect(cipher.decrypt(b)).toBe('same');
  });

  it('rejects tampered ciphertext (GCM auth tag failure)', () => {
    const cipher = new TokenCipher(KEY);
    const encrypted = cipher.encrypt('do-not-tamper');

    const raw = Buffer.from(encrypted, 'base64');
    raw[raw.length - 1] = (raw[raw.length - 1] ?? 0) ^ 0x01; // flip a bit in the ciphertext body
    const tampered = raw.toString('base64');

    expect(() => cipher.decrypt(tampered)).toThrow();
  });

  it('rejects decryption under a different key', () => {
    const encrypted = new TokenCipher(KEY).encrypt('cross-key');
    const other = new TokenCipher(randomBytes(32));

    expect(() => other.decrypt(encrypted)).toThrow();
  });

  it('rejects a truncated payload', () => {
    const cipher = new TokenCipher(KEY);
    expect(() => cipher.decrypt('AAAA')).toThrow(/too short/);
  });

  it('rejects a key that is not 32 bytes', () => {
    expect(() => new TokenCipher(randomBytes(16))).toThrow(/32 bytes/);
  });
});

describe('loadEncryptionKey', () => {
  it('decodes a valid base64 32-byte key', () => {
    const raw = KEY.toString('base64');
    expect(loadEncryptionKey(raw)).toEqual(KEY);
  });

  it('throws when unset', () => {
    expect(() => loadEncryptionKey(undefined)).toThrow(/not set/);
  });

  it('throws when the decoded key is the wrong length', () => {
    expect(() => loadEncryptionKey(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
  });
});
