import { describe, expect, it } from 'vitest';
import { EnvConsoleTokenProvider, extractBearerToken } from './auth.js';

describe('extractBearerToken', () => {
  it('parses a Bearer token', () => {
    expect(extractBearerToken('Bearer abc123')).toBe('abc123');
  });

  it('is case-insensitive on the scheme and trims whitespace', () => {
    expect(extractBearerToken('  bearer   xyz  ')).toBe('xyz');
  });

  it('returns null for a missing or non-bearer header', () => {
    expect(extractBearerToken(undefined)).toBeNull();
    expect(extractBearerToken('Basic abc')).toBeNull();
  });

  it('handles an array header by taking the first value', () => {
    expect(extractBearerToken(['Bearer first', 'Bearer second'])).toBe('first');
  });
});

describe('EnvConsoleTokenProvider', () => {
  it('reads the configured env var', async () => {
    const key = 'TEST_CONSOLE_TOKEN_VAR';
    process.env[key] = 'the-secret';
    try {
      const provider = new EnvConsoleTokenProvider(key);
      expect(await provider.getExpectedToken('venue-1')).toBe('the-secret');
    } finally {
      delete process.env[key];
    }
  });

  it('returns null when the env var is unset', async () => {
    const provider = new EnvConsoleTokenProvider('DEFINITELY_UNSET_TOKEN_VAR');
    expect(await provider.getExpectedToken('venue-1')).toBeNull();
  });
});
