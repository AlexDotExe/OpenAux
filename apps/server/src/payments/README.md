# payments — settlement (WS5)

Layer 5 of SPEC.md §1: money, kept decoupled from ranking. Credits ledger, Priority
Boost purchases, auto-refunds, and 70/30 revenue accounting.

## Endpoints (CONTRACTS.md / api.ts)

- `POST /api/credits/purchase` — buy a credit bundle (Stripe PaymentIntent).
- `POST /api/queue-items/:queueItemId/boosts` — buy a Priority Boost (V0).

Register via `registerPaymentRoutes(app)` from `index.ts`. Do NOT edit
`apps/server/src/index.ts` — the maintainer wires plugins at merge time.

## Design

- **Ledger is source of truth.** Every balance change writes a `credits_ledger` row
  AND updates the `users.credit_balance` cache in the SAME transaction (`repo.withTx`).
  Money is integer cents; credits are integers; all monetary math is in pure functions
  (`rev-split.ts`, `bundles.ts`, `boost-catalog.ts`) with unit tests.
- **Idempotency** on both mutating endpoints via `payment_events.idempotency_key`
  (client `Idempotency-Key` header; a UUID is generated if absent). Double-submits
  replay the prior result instead of charging twice. The card charge happens OUTSIDE
  the DB transaction; Stripe's own idempotency key covers gateway retries.
- **Boost limit** (1 per song per user) is backed by the partial unique index
  `payment_events_one_priority_boost`; a conflict maps to `boost_limit_reached`.
- **Refunds (D14):** `PaymentsService.settleQueueItem(queueItemId, finalStatus)` — when a
  boosted item ends `expired|skipped|blocked` it auto-refunds each boost to the payer's
  credit (`reason 'refund'`, `refund_status 'refunded_to_credit'`), emits `refund_issued`.
  Idempotent: only `refund_status='none'` boosts are refunded.
- **Rev-share (D15):** `computeRevSplit(cents)` splits 70/30, sub-cent remainder to the
  venue. `PaymentsService.venuePayouts()` aggregates completed cash purchases per venue.

## Seams (injectable; defaults wired in `index.ts`)

- `PaymentGateway` — `StripeGateway` (fetch → Stripe REST) / `FakeGateway` (tests).
- `PaymentsRepo` — `PgPaymentsRepo` (shared pool) / `InMemoryPaymentsRepo` (tests).
- `AnalyticsSink` — `PgAnalyticsSink` fallback until WS6's pipeline lands; best-effort,
  never blocks settlement.
- `ActorResolver` — header-based until WS1 session/auth lands.
- `PayoutGateway` (`payouts.ts`) — Stripe Connect stub; documented seam, no money moved.

## For WS3 (queue engine)

Call `PaymentsService.settleQueueItem(queueItemId, finalStatus)` at an item's terminal
state to trigger boost refunds. Build one service with `createPaymentsService(app)`.

## Env vars

- `STRIPE_SECRET_KEY` — required for real charges; absent → FakeGateway (dev only).
- `STRIPE_WEBHOOK_SECRET` — reserved for async Stripe webhooks (not consumed in V0).
- `DATABASE_URL` — via the shared pool.

## Contract gaps (TODOs — do not drive-by edit packages/shared)

- `ApiErrorCode` lacks `boost_type_unavailable` and `payment_gateway_error`
  (widened locally in `errors.ts`).
- `PurchaseCreditsRequest` / `PurchaseBoostRequest` carry no idempotency key; we read the
  `Idempotency-Key` header instead. Consider adding it to the contract.
- No `credit_purchased` analytics event type exists, so credit purchases emit none
  (only `boost_purchased` / `refund_issued`). Revenue analytics is a WS6 concern.
- Stripe Connect payouts need a `venues.stripe_account_id` column (schema change) before
  `StubPayoutGateway` can become real.
- Guest identity is read from `users.auth_provider = 'guest'`; when WS1 lands, prefer the
  session's `is_guest` as the authoritative signal.
