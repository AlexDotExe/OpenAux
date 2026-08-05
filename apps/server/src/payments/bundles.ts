/**
 * Credit bundle table + guest-purchase policy (pure).
 *
 * PROVISIONAL PRICING — these amounts are placeholders pending a real pricing
 * decision (SPEC.md §5 Monetization). All money is integer cents; credits are
 * integers. Keep this table the single source of truth for what a bundle costs.
 */

export interface CreditBundle {
  /** Stable id referenced by PurchaseCreditsRequest.bundleId. */
  id: string;
  /** Credits granted on purchase. */
  credits: number;
  /** Price in integer cents. */
  priceCents: number;
  /** ISO 4217 currency for the Stripe charge. */
  currency: string;
  label: string;
}

/**
 * PROVISIONAL bundle catalog. Ordered smallest → largest by price.
 * Guests may only buy the smallest bundle (SPEC.md §4: guests limited to
 * immediate-use purchases only; no bulk discounts).
 */
export const CREDIT_BUNDLES: readonly CreditBundle[] = [
  { id: 'starter_5', credits: 5, priceCents: 499, currency: 'usd', label: '5 credits' },
  { id: 'value_12', credits: 12, priceCents: 999, currency: 'usd', label: '12 credits' },
] as const;

/** Price per credit in a bundle (cents), useful for UI/analytics. */
export function bundleUnitPriceCents(bundle: CreditBundle): number {
  return bundle.priceCents / bundle.credits;
}

export function getBundle(bundleId: string): CreditBundle | undefined {
  return CREDIT_BUNDLES.find((b) => b.id === bundleId);
}

/** The single cheapest bundle — the only one guests may purchase. */
export function smallestBundle(): CreditBundle {
  return CREDIT_BUNDLES.reduce((min, b) => (b.priceCents < min.priceCents ? b : min));
}

/** Guests are restricted to the smallest bundle only. */
export function isBundleAllowedForGuest(bundleId: string): boolean {
  return bundleId === smallestBundle().id;
}
