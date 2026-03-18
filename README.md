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

## User Authentication (Optional)

Users can optionally sign in to save their stats and credits. Guest mode is the default.

### Supported Sign-In Methods

| Method | Description |
|--------|-------------|
| Email / Password | Standard email registration |
| Spotify OAuth | Sign in via Spotify account |
| Instagram OAuth | Sign in via Instagram account |

### Stay Logged In

Users can check "Stay logged in" to persist their session across browser restarts (stored in `localStorage`). Without this option, the session is stored in `sessionStorage` only.

### Environment Variables for User Auth

Add these to your `.env.local`:

```bash
# Instagram OAuth (for user sign-in)
INSTAGRAM_CLIENT_ID=your_instagram_app_id
INSTAGRAM_CLIENT_SECRET=your_instagram_app_secret
# Also expose app ID to the client for the OAuth redirect:
NEXT_PUBLIC_INSTAGRAM_CLIENT_ID=your_instagram_app_id

# Spotify OAuth for user sign-in (can reuse admin credentials or use a separate app)
SPOTIFY_USER_CLIENT_ID=your_spotify_client_id
SPOTIFY_USER_CLIENT_SECRET=your_spotify_client_secret
NEXT_PUBLIC_SPOTIFY_USER_CLIENT_ID=your_spotify_client_id
```

**Instagram App Setup:**
1. Create an app at [developers.facebook.com](https://developers.facebook.com)
2. Add the Instagram Basic Display product
3. Set the redirect URI to: `{NEXT_PUBLIC_BASE_URL}/api/auth/callback/instagram`

**Spotify App Setup:**
1. Create an app at [developer.spotify.com](https://developer.spotify.com)
2. Set the redirect URI to: `{NEXT_PUBLIC_BASE_URL}/api/auth/callback/spotify`
3. Request scopes: `user-read-private user-read-email`

## Architecture

```
app/
  api/
    auth/          — User auth routes (register, signin, signout, me)
    auth/callback/ — OAuth callbacks (instagram, spotify)
  venues/          — Venue listing & detail pages
  session/         — Live session page (request + vote)
  admin/           — Venue admin dashboard
components/
  AuthModal.tsx       — Sign-in/up modal (email + OAuth + stay-logged-in)
  UserProfileMenu.tsx — Signed-in user profile dropdown
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
