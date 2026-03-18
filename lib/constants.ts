/**
 * Shared application constants
 */

/** Maximum length for a user's DJ display name */
export const MAX_DISPLAY_NAME_LENGTH = 50;

/** Prepaid credit bundles available for purchase */
export const CREDIT_BUNDLES = [
  { key: 'starter', credits: 5, price: 5.0, label: '5 Credits — $5' },
  { key: 'popular', credits: 12, price: 10.0, label: '12 Credits — $10', badge: 'Popular' },
  { key: 'value', credits: 30, price: 20.0, label: '30 Credits — $20', badge: 'Best Value' },
] as const;

export type CreditBundleKey = (typeof CREDIT_BUNDLES)[number]['key'];
