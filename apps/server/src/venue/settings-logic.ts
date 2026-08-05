/**
 * Pure validation/normalization for PATCH /api/venues/:venueId/settings.
 * No I/O — keeps the settings-validation rules unit-testable without a DB.
 */
import type { UpdateVenueSettingsRequest, VenueControlMode } from '@openaux/shared';

export interface SettingsPatch {
  controlMode?: VenueControlMode;
  blockExplicit?: boolean;
  blockedGenres?: string[];
  blockedArtists?: string[];
}

export type SettingsValidationResult =
  { valid: true; patch: SettingsPatch } | { valid: false; message: string };

const VALID_CONTROL_MODES: ReadonlySet<string> = new Set(['crowd', 'suggestion']);

/** Trims, drops empties, and dedupes case-insensitively (keeps first-seen casing). */
function normalizeStringList(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const trimmed = typeof raw === 'string' ? raw.trim() : '';
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

export function validateSettingsUpdate(body: UpdateVenueSettingsRequest): SettingsValidationResult {
  if (body.controlMode !== undefined && !VALID_CONTROL_MODES.has(body.controlMode)) {
    return { valid: false, message: 'controlMode must be "crowd" or "suggestion"' };
  }
  if (body.blockExplicit !== undefined && typeof body.blockExplicit !== 'boolean') {
    return { valid: false, message: 'blockExplicit must be a boolean' };
  }
  if (body.blockedGenres !== undefined && !isStringArray(body.blockedGenres)) {
    return { valid: false, message: 'blockedGenres must be an array of strings' };
  }
  if (body.blockedArtists !== undefined && !isStringArray(body.blockedArtists)) {
    return { valid: false, message: 'blockedArtists must be an array of strings' };
  }

  const patch: SettingsPatch = {};
  if (body.controlMode !== undefined) patch.controlMode = body.controlMode;
  if (body.blockExplicit !== undefined) patch.blockExplicit = body.blockExplicit;
  if (body.blockedGenres !== undefined)
    patch.blockedGenres = normalizeStringList(body.blockedGenres);
  if (body.blockedArtists !== undefined)
    patch.blockedArtists = normalizeStringList(body.blockedArtists);

  if (Object.keys(patch).length === 0) {
    return { valid: false, message: 'no recognized settings fields provided' };
  }
  return { valid: true, patch };
}
