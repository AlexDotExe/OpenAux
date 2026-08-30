import { describe, expect, it } from 'vitest';

import { encodeQr, modulesToSvgPath } from './qrcode';

// Canonical 7x7 finder pattern: dark ring, white ring, 3x3 dark core.
const FINDER = [
  [1, 1, 1, 1, 1, 1, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 0, 1, 1, 1, 0, 1],
  [1, 0, 1, 1, 1, 0, 1],
  [1, 0, 1, 1, 1, 0, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 1, 1, 1, 1, 1, 1],
].map((row) => row.map((v) => v === 1));

function assertFinderAt(modules: boolean[][], top: number, left: number): void {
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      expect(modules[top + r]![left + c]).toBe(FINDER[r]![c]);
    }
  }
}

describe('encodeQr', () => {
  it('produces a square matrix sized version * 4 + 17', () => {
    const qr = encodeQr('https://openaux.app/join/ABC123');
    expect(qr.size).toBe(qr.version * 4 + 17);
    expect(qr.modules.length).toBe(qr.size);
    for (const row of qr.modules) {
      expect(row.length).toBe(qr.size);
    }
  });

  it('places correct finder patterns in the three corners', () => {
    const qr = encodeQr('https://openaux.app/join/ABC123');
    const { modules, size } = qr;
    assertFinderAt(modules, 0, 0); // top-left
    assertFinderAt(modules, 0, size - 7); // top-right
    assertFinderAt(modules, size - 7, 0); // bottom-left
  });

  it('sets the always-dark module', () => {
    const qr = encodeQr('https://openaux.app/join/ABC123');
    expect(qr.modules[qr.size - 8]![8]).toBe(true);
  });

  it('draws the timing patterns as alternating modules', () => {
    const qr = encodeQr('https://openaux.app/join/ABC123');
    for (let i = 8; i < qr.size - 8; i++) {
      expect(qr.modules[6]![i]).toBe(i % 2 === 0);
      expect(qr.modules[i]![6]).toBe(i % 2 === 0);
    }
  });

  it('is deterministic for the same input', () => {
    const url = 'https://openaux.app/join/DETERMINISTIC-CHECK-9999';
    expect(encodeQr(url).modules).toEqual(encodeQr(url).modules);
  });

  it('chooses version 1 (21x21) for very short input', () => {
    const qr = encodeQr('hi');
    expect(qr.version).toBe(1);
    expect(qr.size).toBe(21);
  });

  it('grows the version as input length grows', () => {
    const small = encodeQr('a'.repeat(10));
    const large = encodeQr('a'.repeat(120));
    expect(large.version).toBeGreaterThan(small.version);
    expect(large.size).toBeGreaterThan(small.size);
  });

  it('encodes a realistic 40-80 char join URL within the supported range', () => {
    const url = 'https://openaux.app/patron/join?v=venue-12345&t=qr-abcdef123456';
    const qr = encodeQr(url);
    expect(url.length).toBeGreaterThanOrEqual(40);
    expect(url.length).toBeLessThanOrEqual(80);
    expect(qr.version).toBeGreaterThanOrEqual(1);
    expect(qr.version).toBeLessThanOrEqual(10);
    expect(qr.ecLevel).toBe('M');
  });

  it('throws when the input exceeds the supported capacity', () => {
    expect(() => encodeQr('x'.repeat(1000))).toThrow();
  });

  it('handles multi-byte UTF-8 characters', () => {
    expect(() => encodeQr('café — señor 音楽 🎵')).not.toThrow();
  });
});

describe('modulesToSvgPath', () => {
  it('emits one rect subpath per dark module offset by the quiet zone', () => {
    const modules = [
      [true, false],
      [false, true],
    ];
    const path = modulesToSvgPath(modules, 4);
    const rectCount = (path.match(/h1v1h-1z/g) ?? []).length;
    expect(rectCount).toBe(2);
    expect(path).toContain('M4 4h1v1h-1z'); // module (0,0) at quiet-zone offset
    expect(path).toContain('M5 5h1v1h-1z'); // module (1,1)
  });

  it('returns an empty string when there are no dark modules', () => {
    expect(modulesToSvgPath([[false, false]], 4)).toBe('');
  });
});
