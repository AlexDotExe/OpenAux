-- OpenAux PostgreSQL schema (V0). Canonical — mirrors packages/shared/src/types/domain.ts.
-- Change both together and log the change in CONTRACTS.md.
-- Conventions: snake_case, money in integer cents, credits as integers, timestamptz everywhere.

create extension if not exists "pgcrypto";

create type queue_item_status as enum ('queued', 'playing', 'played', 'skipped', 'expired', 'blocked');
create type queue_item_source as enum ('organic', 'sponsor', 'venue', 'override');
create type playability_state as enum ('playable', 'held', 'awaiting_approval');
create type venue_control_mode as enum ('crowd', 'suggestion');
create type music_provider as enum ('spotify', 'apple_music');
create type auth_provider as enum ('apple', 'google', 'phone', 'guest');
create type vote_direction as enum ('up', 'down');
create type payment_type as enum
  ('credit_purchase', 'priority_boost', 'instant_play_vote', 'super_boost', 'promo_code_redemption');
create type payment_status as enum ('pending', 'completed', 'failed');
create type refund_status as enum ('none', 'pending', 'refunded_to_credit');

create table users (
  user_id         uuid primary key default gen_random_uuid(),
  display_name    text not null,
  auth_provider   auth_provider not null,
  auth_subject    text,                          -- provider-side id; null for guests
  credit_balance  integer not null default 0 check (credit_balance >= 0),
  influence_score numeric not null default 0,
  -- Reputation-based weighting v1 (SPEC.md §5 V1). Counters feed reputation_score,
  -- which feeds the V1 scoring skip_risk/spam inputs. Maintained by the reputation
  -- layer, never inside ranking.
  reputation_score   numeric not null default 0,
  upvotes_received   integer not null default 0,
  downvotes_received integer not null default 0,
  spam_attempts      integer not null default 0,
  songs_skipped      integer not null default 0,
  created_at      timestamptz not null default now(),
  unique (auth_provider, auth_subject)
);

-- Venue operators: the people who create and run venues (distinct from patrons in
-- `users`). Password auth; bearer sessions live in venue_admin_sessions.
create table venue_owners (
  venue_owner_id uuid primary key default gen_random_uuid(),
  email          text not null unique,
  password_hash  text not null,          -- scrypt: "saltHex:hashHex"
  display_name   text not null,
  created_at     timestamptz not null default now()
);

create table venues (
  venue_id                 uuid primary key default gen_random_uuid(),
  -- Owning operator. Nullable so legacy/seeded venues and the shared-secret
  -- fallback keep working; venues created via POST /api/venues always set it.
  owner_id                 uuid references venue_owners(venue_owner_id),
  name                     text not null,
  music_provider           music_provider not null,
  control_mode             venue_control_mode not null default 'crowd',
  qr_token                 text not null unique,
  block_explicit           boolean not null default false,
  blocked_genres           text[] not null default '{}',
  blocked_artists          text[] not null default '{}',
  scoring_weights_override jsonb,                -- partial ScoringWeights; null = defaults
  fallback_playlist        jsonb not null default '[]', -- ordered provider track ids
  -- Venue anthem + promo (SPEC.md §5 Announcements). Null anthem_provider_track_id = no anthem set.
  anthem_provider               music_provider,
  anthem_provider_track_id      text,
  anthem_title                  text,
  anthem_artist                 text,
  anthem_promo_text             text,
  anthem_promo_duration_minutes integer,
  -- Stripe Connect payout account for venue revenue share (payments payout stub).
  stripe_account_id             text,
  -- Spotify Connect device the DJ brain targets; null until picked in the console.
  -- Unused for Apple Music venues (the console browser is the device).
  playback_device_id            text,
  -- Power Hour Mode (SPEC.md §5 V1): venue-activated genre multiplier for a window.
  -- All null when inactive; cleared by the venue layer once power_hour_ends_at passes.
  power_hour_genre              text,
  power_hour_multiplier         numeric,
  power_hour_ends_at            timestamptz,
  -- Venue location for join-time presence verification (SPEC.md §5 V1 / §7).
  -- Sensitive: patron location is captured ONLY at join, for the stated purpose of
  -- confirming presence within geofence_radius_m, and is never stored as precise
  -- history. Null until the venue sets its coordinates.
  latitude                      numeric,
  longitude                     numeric,
  geofence_radius_m             integer,
  created_at               timestamptz not null default now()
);

-- Venue-admin bearer sessions. The token is returned to the operator on
-- signup/login; only its SHA-256 hash is stored, so a DB leak can't replay live
-- tokens. This token is the venue admin bearer credential everywhere (console
-- management routes, Spotify linking, console WebSocket).
create table venue_admin_sessions (
  token_hash     text primary key,       -- sha256(token) hex
  venue_owner_id uuid not null references venue_owners(venue_owner_id),
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null,
  last_used_at   timestamptz
);
create index venue_admin_sessions_owner_idx on venue_admin_sessions (venue_owner_id);

-- Per-venue provider credentials (Spotify user tokens for Connect playback).
-- Token columns hold AES-256-GCM ciphertext (TOKEN_ENCRYPTION_KEY env);
-- plaintext never leaves apps/server/src/providers/.
create table venue_provider_tokens (
  venue_id                uuid not null references venues(venue_id),
  provider                music_provider not null,
  access_token_encrypted  text not null,
  refresh_token_encrypted text,
  expires_at              timestamptz,
  scope                   text,
  updated_at              timestamptz not null default now(),
  primary key (venue_id, provider)
);

create table sessions (
  session_id           uuid primary key default gen_random_uuid(),
  user_id              uuid not null references users(user_id),
  venue_id             uuid not null references venues(venue_id),
  joined_at            timestamptz not null default now(),
  last_active_at       timestamptz not null default now(),
  is_guest             boolean not null default false,
  is_active            boolean not null default true,
  session_expired_at   timestamptz,
  active_request_count integer not null default 0,
  cooldown_ends_at     timestamptz,
  last_vote_at         timestamptz,
  last_request_at      timestamptz,
  -- Coordinates captured at join for presence verification (SPEC.md §5 V1 / §7).
  -- Sensitive: requested only at join with a stated purpose, used to confirm the
  -- patron is within the venue geofence, never treated as location history.
  -- Null when the patron declined or location was not requested.
  join_latitude        numeric,
  join_longitude       numeric
);
create index sessions_venue_active_idx on sessions (venue_id) where is_active;
create unique index sessions_one_active_per_user_venue
  on sessions (user_id, venue_id) where is_active;

create table queue_items (
  queue_item_id            uuid primary key default gen_random_uuid(),
  venue_id                 uuid not null references venues(venue_id),
  song_id                  text not null,        -- provider-native track id
  provider                 music_provider not null,
  requesting_user_id       uuid not null references users(user_id),
  created_at               timestamptz not null default now(),
  status                   queue_item_status not null default 'queued',
  upvotes_count            integer not null default 0,
  downvotes_count          integer not null default 0,
  unique_supporter_count   integer not null default 0,
  priority_boost_count     integer not null default 0,
  instant_vote_count       integer not null default 0,
  super_boost_count        integer not null default 0,
  -- Running tally of crowd-skip votes against this item while playing (SPEC.md §5 V1).
  crowd_skip_votes         integer not null default 0,
  explicit_flag            boolean not null default false,
  genre                    text,
  artist                   text not null,
  title                    text not null,
  is_duplicate_locked      boolean not null default false,
  last_score_calculated_at timestamptz,
  current_score            numeric not null default 0,
  playability_state        playability_state not null default 'playable',
  playability_reason       text,
  source_type              queue_item_source not null default 'organic',
  -- Set when the item transitions to a terminal 'played' state (actual play time,
  -- distinct from created_at = request time). Null until played. Used by the
  -- antispam recently-played lookup and the queue engine's DJ-brain vibe window.
  played_at                timestamptz
);
create index queue_items_live_idx on queue_items (venue_id, status, current_score desc);
-- 45-minute duplicate lockout is enforced in the eligibility layer via this lookup:
create index queue_items_dupe_idx on queue_items (venue_id, song_id, created_at desc);

create table votes (
  queue_item_id uuid not null references queue_items(queue_item_id),
  user_id       uuid not null references users(user_id),
  direction     vote_direction not null,
  created_at    timestamptz not null default now(),
  primary key (queue_item_id, user_id)           -- one vote per user per song; re-vote switches
);

create table payment_events (
  payment_event_id  uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users(user_id),
  venue_id          uuid not null references venues(venue_id),
  queue_item_id     uuid references queue_items(queue_item_id),
  payment_type      payment_type not null,
  credit_amount     integer not null default 0,
  cash_amount_cents integer not null default 0,
  created_at        timestamptz not null default now(),
  status            payment_status not null default 'pending',
  refund_status     refund_status not null default 'none',
  idempotency_key   text unique
);
-- Priority Boost: limit 1 per song per user (SPEC.md V0)
create unique index payment_events_one_priority_boost
  on payment_events (user_id, queue_item_id)
  where payment_type = 'priority_boost' and status = 'completed';

create table credits_ledger (
  entry_id         uuid primary key default gen_random_uuid(),
  user_id          uuid not null references users(user_id),
  delta            integer not null,              -- + credit added, − credit spent
  reason           text not null,
  payment_event_id uuid references payment_events(payment_event_id),
  created_at       timestamptz not null default now()
);
create index credits_ledger_user_idx on credits_ledger (user_id, created_at desc);

-- Boost Codes (SPEC.md §5 V1, decision D7): venues generate single-use promo codes
-- from app-fixed tiers (beer +1 / cocktail +2 / bottle +10) tied to qualifying
-- purchases; a patron redeems a code for credits. Codes expire 30 min after issue.
-- credit_value is set by the server from the tier (not venue-arbitrary).
create table boost_codes (
  boost_code_id uuid primary key default gen_random_uuid(),
  code          text not null unique,
  venue_id      uuid not null references venues(venue_id),
  tier          text not null check (tier in ('beer', 'cocktail', 'bottle')),
  credit_value  integer not null,
  issued_at     timestamptz not null default now(),
  expires_at    timestamptz not null,
  redeemed_by   uuid references users(user_id),
  redeemed_at   timestamptz
);
create index boost_codes_venue_idx on boost_codes (venue_id, issued_at desc);

create table analytics_events (
  event_id        uuid primary key default gen_random_uuid(),
  event_type      text not null,                 -- ANALYTICS_EVENT_TYPES in shared contract
  event_timestamp timestamptz not null default now(),
  actor_user_id   uuid,
  venue_id        uuid not null,
  queue_item_id   uuid,
  metadata_json   jsonb not null default '{}'
);
create index analytics_events_venue_time_idx on analytics_events (venue_id, event_timestamp desc);
create index analytics_events_type_time_idx on analytics_events (event_type, event_timestamp desc);
