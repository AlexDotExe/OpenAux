# OpenAux 🎵

> Virtual DJ — powered by the crowd

A QR-based web app for bars and clubs. No app download required.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Set up environment
cp .env.example .env.local
# Edit .env.local with your PostgreSQL connection string

# 3. Set up database
npx prisma migrate dev --name init
npx prisma db seed

# 4. Run the app
npm run dev
```

## User Flow

1. Venue admin scans/shares QR code → `/venues/[venueId]`
2. User sees venue page and joins the live session
3. User requests songs, votes up/down
4. Virtual DJ engine auto-ranks the queue by weighted vote scores
5. Admin controls session from `/admin/[venueId]`

## Architecture

```
app/
  api/           — Next.js API routes (thin controllers)
  venues/        — Venue listing & detail pages
  session/       — Live session page (request + vote)
  admin/         — Venue admin dashboard
components/      — Reusable UI components
lib/
  db/            — Data access layer (Prisma queries)
  services/      — Business logic (virtualDjEngine, userService, etc.)
  store/         — Zustand client state
  stubs/         — Future feature interfaces (not implemented)
prisma/
  schema.prisma  — Database schema
  seed.ts        — Sample data
```

## Virtual DJ Engine

See `lib/services/virtualDjEngine.ts`.

Score formula:
```
score = SUM(vote.value × vote.weight) × energyAdjustment × crowdFactor
```

- **vote.weight** = user's influence weight (derived from reputation)
- **energyAdjustment** = BPM proximity to energy target (0.5–1.0)
- **crowdFactor** = slight boost for larger crowds

## Future Features (Stubbed)

- `lib/stubs/reputationJob.ts` — Background reputation recalculation
- `lib/stubs/analyticsService.ts` — Session analytics export
- `lib/stubs/boostService.ts` — Paid song boost
- `lib/stubs/labelTrackService.ts` — Label track injection / A/B testing
