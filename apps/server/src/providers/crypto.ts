/**
 * Symmetric encryption for per-venue Spotify user tokens (AES-256-GCM) and
 * HMAC signing for the OAuth `state` parameter.
 *
 * Both use the 32-byte key from TOKEN_ENCRYPTION_KEY (base64-encoded — see
 * .env.example). Plaintext tokens are confined to apps/server/src/providers/;
 * anything that crosses the persistence boundary (the DB, the wire) is
 * ciphertext produced here.
 *
 * These are pure helpers with no I/O — unit-tested with a roundtrip and a
 * tamper-detection case.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12; // 96-bit nonce, the GCM standard/recommended size.
const AUTH_TAG_BYTES = 16;

/**
 * Decodes and validates the TOKEN_ENCRYPTION_KEY env value. The key is
 * base64-encoded and must decode to exactly 32 bytes.
 */
export function loadEncryptionKey(
  raw: string | undefined,
  envName = 'TOKEN_ENCRYPTION_KEY',
): Buffer {
  if (!raw) {
    throw new Error(
      `${envName} is not set. Provide a base64-encoded 32-byte key (see .env.example).`,
    );
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `${envName} must decode to ${KEY_BYTES} bytes (base64); decoded ${key.length} bytes.`,
    );
  }
  return key;
}

/**
 * AES-256-GCM authenticated encryption. Each `encrypt` uses a fresh random
 * IV; the serialized payload is base64(iv ‖ authTag ‖ ciphertext). `decrypt`
 * throws if the ciphertext or auth tag has been tampered with.
 */
export class TokenCipher {
  private readonly key: Buffer;

  constructor(key: Buffer) {
    if (key.length !== KEY_BYTES) {
      throw new Error(`TokenCipher key must be ${KEY_BYTES} bytes, got ${key.length}.`);
    }
    this.key = key;
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
  }

  decrypt(payload: string): string {
    const buf = Buffer.from(payload, 'base64');
    if (buf.length < IV_BYTES + AUTH_TAG_BYTES) {
      throw new Error('TokenCipher: ciphertext payload is too short to be valid.');
    }
    const iv = buf.subarray(0, IV_BYTES);
    const authTag = buf.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
    const ciphertext = buf.subarray(IV_BYTES + AUTH_TAG_BYTES);
    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);
    // decipher.final() throws if the auth tag does not verify (tamper detection).
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }
}
