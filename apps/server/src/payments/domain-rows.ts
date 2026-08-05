/**
 * Re-exports of the shared domain enums the payments layer persists, plus a
 * ledger-entry view. Kept separate from repo.ts to avoid import cycles and to
 * pin exactly which contract types settlement writes.
 */
export type { PaymentType, PaymentStatus, RefundStatus, CreditsLedgerEntry } from '@openaux/shared';

/** users.auth_provider enum (see db/schema.sql). */
export type AuthProvider = 'apple' | 'google' | 'phone' | 'guest';
