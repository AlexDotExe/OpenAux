/**
 * Pure logic for the venue anthem feature (spec §5 "Venue's Anthem" +
 * "Venue anthem announcements"). No I/O.
 */
import type { MusicProviderId } from '@openaux/shared';

export interface AnthemMatchTarget {
  provider: MusicProviderId;
  songId: string;
}

export interface AnthemMatchConfig {
  provider: MusicProviderId;
  providerTrackId: string;
}

/** True when the item that just started playing is the venue's configured anthem. */
export function isAnthemWin(item: AnthemMatchTarget, anthem: AnthemMatchConfig | null): boolean {
  if (!anthem) return false;
  return item.provider === anthem.provider && item.songId === anthem.providerTrackId;
}

export interface SetAnthemInput {
  providerTrackId: string;
  promoText: string;
  promoDurationMinutes: number;
}

export type AnthemValidationResult = { valid: true } | { valid: false; message: string };

export function validateAnthemRequest(body: Partial<SetAnthemInput>): AnthemValidationResult {
  if (typeof body.providerTrackId !== 'string' || body.providerTrackId.trim().length === 0) {
    return { valid: false, message: 'providerTrackId is required' };
  }
  if (typeof body.promoText !== 'string' || body.promoText.trim().length === 0) {
    return { valid: false, message: 'promoText is required' };
  }
  if (
    typeof body.promoDurationMinutes !== 'number' ||
    !Number.isFinite(body.promoDurationMinutes) ||
    body.promoDurationMinutes <= 0
  ) {
    return { valid: false, message: 'promoDurationMinutes must be a positive number' };
  }
  return { valid: true };
}
