import { describe, expect, it } from 'vitest';
import { authorizeConsole, parseConnectionParams } from './index.js';

describe('parseConnectionParams', () => {
  it('defaults to the patron role', () => {
    const params = parseConnectionParams(new URL('http://x/ws/venues/v1?sessionId=s1'));
    expect(params).toEqual({ role: 'patron', sessionId: 's1', token: null });
  });

  it('parses a console handshake with a token', () => {
    const params = parseConnectionParams(
      new URL('http://x/ws/venues/v1?role=console&token=secret'),
    );
    expect(params).toEqual({ role: 'console', sessionId: null, token: 'secret' });
  });

  it('treats any non-"console" role value as patron', () => {
    const params = parseConnectionParams(new URL('http://x/ws/venues/v1?role=admin'));
    expect(params.role).toBe('patron');
  });
});

describe('authorizeConsole', () => {
  it('accepts a matching token', () => {
    expect(authorizeConsole('secret', 'secret')).toBe(true);
  });

  it('rejects a mismatched token', () => {
    expect(authorizeConsole('nope', 'secret')).toBe(false);
  });

  it('fails closed when no token is configured', () => {
    expect(authorizeConsole('anything', null)).toBe(false);
    expect(authorizeConsole('anything', '')).toBe(false);
  });

  it('rejects an absent provided token', () => {
    expect(authorizeConsole(null, 'secret')).toBe(false);
  });
});
