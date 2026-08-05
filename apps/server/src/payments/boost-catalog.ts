/**
 * Boost catalog (pure). V0 ships Priority Boost only.
 *
 * Instant Play Vote (V1) and Super Boost (V2) are declared here so the API can
 * give a precise "not yet available" answer, but they are not purchasable in V0.
 */
import type { PurchaseBoostRequest } from '@openaux/shared';

export type BoostType = PurchaseBoostRequest['boostType'];

export interface BoostDef {
  type: BoostType;
  /** Credits debited to buy this boost. */
  creditCost: number;
  /** Whether V0 allows purchasing it. */
  availableInV0: boolean;
  /** Max purchases of this boost per user per queue item. */
  perSongPerUserLimit: number;
  label: string;
}

/** SPEC.md §5 / decision D2: Priority Boost = 1 credit ($1), limit 1 per song per user. */
export const BOOST_CATALOG: Record<BoostType, BoostDef> = {
  priority_boost: {
    type: 'priority_boost',
    creditCost: 1,
    availableInV0: true,
    perSongPerUserLimit: 1,
    label: 'Priority Boost',
  },
  instant_play_vote: {
    type: 'instant_play_vote',
    creditCost: 3,
    availableInV0: false,
    perSongPerUserLimit: 1,
    label: 'Instant Play Vote',
  },
  super_boost: {
    type: 'super_boost',
    creditCost: 5,
    availableInV0: false,
    perSongPerUserLimit: 1,
    label: 'Super Boost',
  },
};

export function getBoostDef(type: BoostType): BoostDef {
  return BOOST_CATALOG[type];
}
