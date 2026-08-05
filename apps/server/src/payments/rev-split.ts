/**
 * Revenue-share accounting (SPEC.md §1 layer 5, decision D15): 70% venue / 30% app.
 *
 * Pure integer-cents math. The split is configurable per contract (D15) via a
 * basis-points venue share. Any sub-cent remainder is awarded to the VENUE
 * (the app never rounds in its own favor).
 */

/** Default venue share: 70% expressed in basis points (of 10,000). */
export const DEFAULT_VENUE_SHARE_BPS = 7000;

export interface RevSplit {
  /** Total charged, integer cents. */
  totalCents: number;
  /** Venue's cut, integer cents (receives the rounding remainder). */
  venueCents: number;
  /** App's cut, integer cents (floored). */
  appCents: number;
  /** Venue share used, in basis points. */
  venueShareBps: number;
}

/**
 * Split `totalCents` into venue/app cuts.
 *
 * App cut is floored from its exact share, venue takes the rest — so
 * `venueCents + appCents === totalCents` exactly and the remainder lands on
 * the venue. Negative totals (e.g. refunds/chargebacks) split symmetrically.
 */
export function computeRevSplit(
  totalCents: number,
  venueShareBps: number = DEFAULT_VENUE_SHARE_BPS,
): RevSplit {
  if (!Number.isInteger(totalCents)) {
    throw new Error(`computeRevSplit expects integer cents, got ${totalCents}`);
  }
  if (venueShareBps < 0 || venueShareBps > 10000) {
    throw new Error(`venueShareBps must be within [0, 10000], got ${venueShareBps}`);
  }
  const appShareBps = 10000 - venueShareBps;
  // Floor the app's exact share toward zero; venue absorbs the remainder.
  const appCents = Math.trunc((totalCents * appShareBps) / 10000);
  const venueCents = totalCents - appCents;
  return { totalCents, venueCents, appCents, venueShareBps };
}
