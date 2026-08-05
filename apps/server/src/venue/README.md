# venue — see ownership map in CLAUDE.md before editing

WS4: venue control modes, blocks, manual overrides, suggestion-mode
approvals, skip, fallback playlist, anthem, and the two announcement types
this workstream owns (dj_attribution, venue_anthem/anthem_won).

- `index.ts` — `registerVenueRoutes` Fastify plugin (entry point) +
  `createVenueAnnouncementsService` (the `notifyNowPlaying` hook factory for
  WS3's queue engine).
- `types.ts` — injectable seams (`QueueControl`, `Broadcaster`,
  `MusicProviderResolver`, `VenueRepository`) so this module never imports
  from `queue/`, `realtime/`, or `providers/`.
- `*-logic.ts` — pure, DB-free validation/decision functions (unit tested).
- `repository.ts` — Postgres-backed `VenueRepository` (uses the shared pool
  from `../db.ts`); see the contract-gap notes at the top of the file for
  the `venues.anthem_*` columns it assumes but that don't exist yet in
  `db/schema.sql`.
- `auth.ts` — provisional venue-admin token guard (env-based stub).
- `test-support/fake-repository.ts` — in-memory `VenueRepository` used by
  `routes.test.ts`; not part of the production surface.

See the WS4 handoff summary (branch `ws4/venue-controls`) for the full list
of contract gaps and the `QueueControl` shape WS3 needs to satisfy.
