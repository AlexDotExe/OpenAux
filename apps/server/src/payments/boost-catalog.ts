/**
 * Boost catalog (pure). V1 ships Priority Boost + Instant Play Vote.
 *
 * Super Boost (V2) is declared here so the API can give a precise "not yet
 * available" answer, but it is not purchasable yet. The `available` flag is the
 * single gate the purchase path consults (index.ts allowlist + purchaseBoost).
 */
import type { PurchaseBoostRequest } from '@openaux/shared';

export type BoostType = PurchaseBoostRequest['boostType'];

/**
 * queue_items tally each boost increments on purchase (mirrors the snake_case
 * column). Drives which per-song count the purchase path bumps and keeps the
 * scoring inputs (priorityBoostCount / instantVoteCount / superBoostCount) fed.
 */
export type BoostCountColumn = 'priority_boost_count' | 'instant_vote_count' | 'super_boost_count';

export interface BoostDef {
  type: BoostType;
  /** Credits debited to buy this boost. */
  creditCost: number;
  /** Whether this boost is purchasable in the current release. */
  available: boolean;
  /** Max purchases of this boost per user per queue item. */
  perSongPerUserLimit: number;
  /** The queue_items count this boost increments on purchase. */
  countColumn: BoostCountColumn;
  label: string;
}

/**
 * SPEC.md §5 / decisions D2, D4: Priority Boost = 1 credit ($1); Instant Play
 * Vote = 3 credits ($3, V1); Super Boost = 5 credits ($5, V2). All limited to 1
 * per song per user.
 */
export const BOOST_CATALOG: Record<BoostType, BoostDef> = {
  priority_boost: {
    type: 'priority_boost',
    creditCost: 1,
    available: true,
    perSongPerUserLimit: 1,
    countColumn: 'priority_boost_count',
    label: 'Priority Boost',
  },
  instant_play_vote: {
    type: 'instant_play_vote',
    creditCost: 3,
    available: true,
    perSongPerUserLimit: 1,
    countColumn: 'instant_vote_count',
    label: 'Instant Play Vote',
  },
  super_boost: {
    type: 'super_boost',
    creditCost: 5,
    available: false,
    perSongPerUserLimit: 1,
    countColumn: 'super_boost_count',
    label: 'Super Boost',
  },
};

/** Paid boost types eligible for an auto-refund when a song never plays (D14). */
export const REFUNDABLE_BOOST_TYPES: readonly BoostType[] = [
  'priority_boost',
  'instant_play_vote',
  'super_boost',
];

export function getBoostDef(type: BoostType): BoostDef {
  return BOOST_CATALOG[type];
}
