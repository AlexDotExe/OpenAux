import { describe, expect, it } from 'vitest';
import { validateSettingsUpdate } from './settings-logic.js';

describe('validateSettingsUpdate', () => {
  it('accepts a valid controlMode change', () => {
    const result = validateSettingsUpdate({ controlMode: 'suggestion' });
    expect(result).toEqual({ valid: true, patch: { controlMode: 'suggestion' } });
  });

  it('rejects an invalid controlMode', () => {
    const result = validateSettingsUpdate({ controlMode: 'anarchy' as never });
    expect(result.valid).toBe(false);
  });

  it('accepts blockExplicit boolean', () => {
    const result = validateSettingsUpdate({ blockExplicit: true });
    expect(result).toEqual({ valid: true, patch: { blockExplicit: true } });
  });

  it('rejects non-boolean blockExplicit', () => {
    const result = validateSettingsUpdate({ blockExplicit: 'yes' as never });
    expect(result.valid).toBe(false);
  });

  it('trims, drops empties, and dedupes blockedGenres case-insensitively', () => {
    const result = validateSettingsUpdate({
      blockedGenres: [' Country ', 'country', 'Hip-Hop', '', '  '],
    });
    expect(result).toEqual({
      valid: true,
      patch: { blockedGenres: ['Country', 'Hip-Hop'] },
    });
  });

  it('normalizes blockedArtists the same way', () => {
    const result = validateSettingsUpdate({ blockedArtists: ['Drake', ' drake '] });
    expect(result).toEqual({ valid: true, patch: { blockedArtists: ['Drake'] } });
  });

  it('rejects blockedGenres that is not an array of strings', () => {
    const result = validateSettingsUpdate({ blockedGenres: [1, 2] as never });
    expect(result.valid).toBe(false);
  });

  it('combines multiple fields into one patch', () => {
    const result = validateSettingsUpdate({
      controlMode: 'crowd',
      blockExplicit: false,
      blockedGenres: ['edm'],
      blockedArtists: ['x'],
    });
    expect(result).toEqual({
      valid: true,
      patch: {
        controlMode: 'crowd',
        blockExplicit: false,
        blockedGenres: ['edm'],
        blockedArtists: ['x'],
      },
    });
  });

  it('rejects an empty body with no recognized fields', () => {
    const result = validateSettingsUpdate({});
    expect(result.valid).toBe(false);
  });
});
