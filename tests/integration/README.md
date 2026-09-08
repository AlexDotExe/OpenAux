# Integration tests (T2)

DB-backed tests that drive the **real server process** over HTTP against a **real
Postgres**, using the deterministic fake music provider (no Spotify/Stripe
credentials, no network).

## Why this layer exists

The unit suite (`npm test`, 620+ tests) stubs both the database and the music
provider. That makes it fast and good for pure logic, but **structurally blind to
SQL and wiring bugs**. Two shipped showstoppers were invisible to it and only
surfaced when the app was run for real:

- `markFinished` used one query parameter as both an enum and text, so Postgres
  rejected it and **every queue advance failed**.
- Spotify's `/v1/artists` genre-enrichment call returned 403 on restricted app
  tiers, and the unconditional `await` made **every song request fail**.

Both would have failed loudly on the first run of this suite.

## Run it

```bash
npm run test:integration:up      # start Postgres (schema.sql applied on first boot)
npm run test:integration         # run the suite
npm run test:integration:down    # stop and delete the volume
```

This suite is deliberately **excluded from the unit gate** — the root vitest
config only globs `packages/**` and `apps/**`, so `npm test` never needs Docker.

### Pointing at a different database

The suite reads `TEST_DATABASE_URL` (default
`postgres://openaux:openaux@localhost:5433/openaux_test`). Any Postgres with
`db/schema.sql` applied works:

```bash
TEST_DATABASE_URL='postgres://user:pass@localhost:5432/my_test_db' npm run test:integration
```

Useful when Docker is unavailable or a Postgres is already running — create an
empty database, apply `db/schema.sql`, and point the variable at it.

## How it works

- `helpers/server.ts` spawns `apps/server/src/index.ts` on port 4010 with
  `MUSIC_PROVIDER_FAKE=1` and a test console token, waits for `/health`, and
  tears the process down afterwards. Spawning the real entrypoint (rather than
  re-composing the app in-test) is the point: it exercises the actual
  composition root, route registration, and the shared pg pool.
- `helpers/api.ts` wraps fetch and encodes the auth transports. Note the API is
  not uniform yet (issue #85): queue endpoints take `X-Session-Id`, payment
  endpoints take `X-User-Id` (+ `X-Venue-Id` on credit purchase), and
  venue-admin/console endpoints take a bearer token.
- `api-flow.test.ts` creates a **fresh owner and venue per run**, so state-dependent
  behavior is deterministic. This matters for crowd-skip: its threshold is
  `max(3, ceil(0.5 x active users))`, so on a shared venue with accumulated
  sessions the threshold drifts upward and the skip can never be reached.

## Coverage

owner signup → venue create → public venue read (and 404 on unknown) → QR join
(and bad-token rejection) → track requests → catalog search → duplicate lockout →
voting with exact V0 score assertions → credit purchase → Priority Boost +
Instant Play Vote paid-point values → insufficient-credits rejection → queue
advance (and console-token enforcement) → crowd-skip tally, per-user guard, and
the **actual skip at threshold** → Power Hour (+ admin auth) → boost code
generate / redeem / double-redeem rejection / unknown code.
