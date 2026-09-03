/**
 * Pure logic for Power Hour Mode (SPEC.md §5 V1): request validation,
 * window-end computation, and active-at-time resolution. No I/O.
 *
 * The multiplier itself is consumed by WS3 queue scoring, which reads the
 * venues.power_hour_* columns directly — this workstream only persists and
 * exposes the window.
 */
import type { PowerHourState } from '@openaux/shared';

export interface PowerHourInput {
  genre: string;
  multiplier: number;
  durationMinutes: number;
}

export type PowerHourValidationResult = { valid: true } | { valid: false; message: string };

/** Guard rails so a fat-fingered console entry can't boost a genre forever / absurdly. */
export const POWER_HOUR_MAX_MULTIPLIER = 10;
export const POWER_HOUR_MAX_DURATION_MINUTES = 240;

export function validatePowerHourRequest(body: Partial<PowerHourInput>): PowerHourValidationResult {
  if (typeof body.genre !== 'string' || body.genre.trim().length === 0) {
    return { valid: false, message: 'genre is required' };
  }
  if (
    typeof body.multiplier !== 'number' ||
    !Number.isFinite(body.multiplier) ||
    body.multiplier <= 1 ||
    body.multiplier > POWER_HOUR_MAX_MULTIPLIER
  ) {
    return {
      valid: false,
      message: `multiplier must be a number > 1 and <= ${POWER_HOUR_MAX_MULTIPLIER}`,
    };
  }
  if (
    typeof body.durationMinutes !== 'number' ||
    !Number.isFinite(body.durationMinutes) ||
    body.durationMinutes <= 0 ||
    body.durationMinutes > POWER_HOUR_MAX_DURATION_MINUTES
  ) {
    return {
      valid: false,
      message: `durationMinutes must be a number > 0 and <= ${POWER_HOUR_MAX_DURATION_MINUTES}`,
    };
  }
  return { valid: true };
}

/** Instant a window activated `now` for `durationMinutes` should end. */
export function powerHourEndsAt(now: Date, durationMinutes: number): Date {
  return new Date(now.getTime() + durationMinutes * 60_000);
}

/** Raw venue power-hour columns as read from the venues row (all null when inactive). */
export interface PowerHourFields {
  genre: string | null;
  multiplier: number | null;
  endsAt: Date | null;
}

/**
 * Resolve the active Power Hour state at `now`, or null when inactive/expired.
 *
 * No-background-timer approach: we never schedule a job to clear the window.
 * The window is stored as (genre, multiplier, endsAt); every read recomputes
 * whether it is still live by comparing `endsAt` to `now`. A window whose
 * `endsAt` has passed reads as inactive (null) even before its columns are
 * physically cleared, so scoring and the summary are correct on read. The
 * lazy clear + `power_hour_ended` broadcast is driven by the read path (see
 * `isPowerHourExpired` and `power-hour.ts` reconcilePowerHourOnRead).
 */
export function powerHourStateAt(fields: PowerHourFields, now: Date): PowerHourState | null {
  if (fields.genre === null || fields.multiplier === null || fields.endsAt === null) {
    return null;
  }
  if (fields.endsAt.getTime() <= now.getTime()) {
    return null;
  }
  return {
    genre: fields.genre,
    multiplier: fields.multiplier,
    endsAt: fields.endsAt.toISOString(),
  };
}

/** True when a stored window exists but has already elapsed at `now` (needs a lazy clear). */
export function isPowerHourExpired(fields: PowerHourFields, now: Date): boolean {
  return (
    fields.genre !== null &&
    fields.multiplier !== null &&
    fields.endsAt !== null &&
    fields.endsAt.getTime() <= now.getTime()
  );
}

/** Banner copy for the shared display while the window is live (SPEC.md §5). */
export function buildPowerHourBannerText(genre: string, multiplier: number): string {
  return `🔥 ${genre} boosted ×${multiplier}`;
}
