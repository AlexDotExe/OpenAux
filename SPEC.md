# OpenAux — Refined Implementation Spec

OpenAux is a social jukebox. Patrons at a venue scan a QR code, join the venue's live session, request songs from Spotify / Apple Music catalogs, and upvote/downvote songs in the queue. Queue order is driven by a scoring engine that blends crowd demand, paid boosts, reputation, venue context, and anti-spam friction. Venues get control modes, drink-promo tie-ins, and analytics dashboards.

This document consolidates the original spec ("OpenAux - Spec Doc.pdf"), resolves its ambiguities (decisions logged in §9), and lists every implementation as a build item grouped by milestone. Estimates use the original scale: **1–3 Easy** (≤1 day), **5–8 Medium** (days–1 week), **13–21 Hard** (weeks).

---

## 1. System Architecture — Six Independent Layers

Every song request flows through these layers. **Keep them decoupled** — this is the core architectural rule from the spec.

| Layer              | Responsibility                                                                                                                                                                                                                       | Output                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| **1. Eligibility** | Can this song be in the live queue at all? Venue blocklists (artist/genre/explicit), duplicate lockout, max active requests per user, cooldowns, session validity. Later: location presence, quality gates.                          | Binary: `eligible = true/false`            |
| **2. Ranking**     | Among eligible songs, what order?                                                                                                                                                                                                    | `queue_rank_score` (float)                 |
| **3. Playability** | Does the top-ranked song actually play _now_? Min active users, min positive ratio, super-boost approval threshold, suggestion-mode venue approval, anthem/sponsor unlock logic. A song can be ranked #1 and still fail playability. | `playability_state` + `playability_reason` |
| **4. Overrides**   | Temporary events that supersede normal ranking: venue manual play, Pass-the-Aux winner, sponsor activation, venue anthem, bartender promo event, brand promotions. Live _above_ queue logic as controlled override events.           | Override event queue                       |
| **5. Settlement**  | Money, separate from ranking: coin purchases, per-action charges, refunds for paid songs that never play, venue/company rev share (**70% venue / 30% app**), promo redemption, prepaid credit accounting.                            | Payment events, ledger                     |
| **6. Analytics**   | Log everything independently of live queue logic: request created, vote added/removed, boost purchased, song played/skipped, session started/expired, venue override used.                                                           | Append-only event log                      |

## 2. Platform & Integrations

Not detailed in the original doc but required by the product's core premise:

- **Client**: Mobile-first web app (no download for guests). QR scan → auto-open web app → auto-join venue session.
- **Auth**: Apple / Google login OR phone number. Guest mode allowed (see §4 sign-in).
- **Music APIs**:
  - **Spotify**: Web API for catalog search/metadata + audio features (tempo/genre); Spotify Connect / Web Playback SDK for playback on the venue's device (venue needs Spotify Premium).
  - **Apple Music**: MusicKit JS for catalog search + playback (venue needs Apple Music subscription).
  - Abstract both behind a single internal `MusicProvider` interface (search, track metadata, queue-next, play, now-playing state). The venue picks its provider at setup; a session uses one provider at a time.
- **Playback authority**: the venue device is the single playback owner; the backend tells it what to play next. Patron phones never play audio.
- **Realtime**: WebSocket (or similar) channel per venue for live queue updates, vote counts, announcements, reactions.
- **Payments**: Stripe (cards + Apple/Google Pay) for coin/credit purchases; Stripe Connect for venue payouts on the 70/30 split.

## 3. Data Model (V0)

### queue_items

`queue_item_id, venue_id, song_id, requesting_user_id, created_at, status (queued|playing|played|skipped|expired|blocked), upvotes_count, downvotes_count, unique_supporter_count, priority_boost_count, instant_vote_count, super_boost_count, explicit_flag, genre, artist, is_duplicate_locked, last_score_calculated_at, current_score, playability_state, playability_reason, source_type (organic|sponsor|venue|override)`

### sessions (user–venue)

`session_id, user_id, venue_id, joined_at, last_active_at, is_guest, active_request_count, cooldown_ends_at, is_active, session_expired_at, last_vote_at, last_request_at`

### payment_events

`payment_event_id, user_id, venue_id, queue_item_id (nullable), payment_type, credit_amount, cash_amount, created_at, status, refund_status`

### analytics_events

`event_id, event_type, event_timestamp, actor_user_id, venue_id, queue_item_id, metadata_json`

Also needed (implied): `users`, `venues` (provider config, control mode, blocklists, QR token), `votes` (one row per user/song vote so counts are unique and reversible), `credits_ledger`.

## 4. Scoring Engine

### V0 formula (ship this first)

```
QueueRankScore = DemandScore + PaymentScore − FrictionScore

DemandScore  = RequestBase
             + UpvoteWeight × upvotes_count
             − DownvoteWeight × downvotes_count
             + UniqueSupporterWeight × unique_supporter_count
PaymentScore = PriorityBoostWeight × priority_boost_count
FrictionScore = ArtistRepeatPenalty + SpamPenalty
```

**V0 default weights** (all configurable per venue, stored server-side):

| Weight                | Value | Rationale                                             |
| --------------------- | ----- | ----------------------------------------------------- |
| RequestBase           | 2     | A request is already meaningful intent                |
| UpvoteWeight          | 1     | Baseline unit                                         |
| DownvoteWeight        | 1.25  | Active resistance > passive interest                  |
| UniqueSupporterWeight | 0.5   | Distinct supporters valuable, don't double-count hard |
| PriorityBoostWeight   | 3     | $1 boost ≈ a few strong votes, never an override      |

**Tiebreakers, in order**: higher unique supporter count → earlier created_at → lower downvote count.

### V1+ evolution (from the "Possible Algorithm Logic" section)

When Instant Play Vote and Super Boost land, evolve the engine to the capped model:

```
score(s) = A·net_votes(s) + B·paid_points_capped(s) + C·time_boost(s)
         − D·skip_risk(s) − E·spam(s)

net_votes  = up − 0.7·down
time_boost = log(1 + age_minutes)        // older requests slowly rise
paid points: Priority Boost = +1, Instant Play Vote = +4, Super Boost = +7
paid_points_capped = min(paid_points, cap)   // cap ≈ 25–40% of what's needed to win
Starting weights: A=1.0, B=0.6, C=0.4, D=2.0, E=3.0 (tunable per venue)
```

**Hard guardrails** (V1+, playability layer):

- Minimum crowd approval to play when ≥10 active users in session: `up ≥ 6 AND up/(up+down) ≥ 0.60`. Below 10 active users the gate is off (see decision D3).
- Per-user per 10 min: max 3 votes, max 1 paid action, max 1 request.
- Super Boost still requires ≥30% positive ratio — paid actions never override crowd hate.

**Queue selection ("DJ brain")**: build eligible set → pick highest score that also fits vibe constraints (no same artist within last X songs; venue do-not-play list; BPM continuity deferred to V6 AI queue).

---

## 5. Implementation List by Milestone

Status/estimates carried from the doc. "Implemented" = existing prototype behavior to preserve/port.

### V0 — MVP (crowd jukebox + basic monetization)

**Core (already prototyped — port/verify)**

- [x] QR venue join
- [x] Song request system with crowd voting queue (upvotes/downvotes, request timestamp)
- [x] Max 3 active requests per user
- [x] Same song not requestable more than once per 45 min
- [x] Announcements framework

**Accounts** _(5)_

- [ ] User sign-in (Apple/Google/phone) — saves settings/stats, enables bulk coin purchase + discounts. Guest users limited to immediate-use purchases only.

**Anti-spam**

- [ ] Session expiry after 1 hour inactivity _(1)_
- [ ] Cooldown: 1 request per 2 minutes per user _(1)_

**Scoring engine**

- [ ] V0 QueueRankScore engine with weights/tiebreakers from §4 (resolves the "how much paid-boosts" Clarify — PriorityBoostWeight = 3) _(3, new estimate)_

**Monetization**

- [ ] Payment intake + venue/company payout (70/30 split) _(5)_
- [ ] Prepaid credit tracking/ledger _(5)_
- [ ] Priority Boost $1 — +3-ish positions via score; limit 1 per song per user _(2)_
- [ ] Refund mechanism when a paid song never plays (auto-refund to credit at session end; still counts toward user score history) _(5)_
- [ ] Venue's Anthem — venue attaches song to a drink special; if it wins, promo activates for 5 min _(5)_
- [ ] Monetization UI: "Your song: #6 in queue" _(1)_, "Boost to #3 for $1" _(2)_

**Venue control**

- [ ] Option to start session with a venue-loaded playlist/queue (also the silent-queue fallback) _(3)_
- [ ] Crowd Control mode — crowd-run, venue can override any time _(1)_
- [ ] Venue blocks: explicit songs, genres, artists _(3)_ — tempo-range blocking deferred (see D6)
- [ ] Suggestion mode — every request requires venue approval _(1)_

**Announcements**

- [ ] "DJ Alex is playing…" — credit the user who won the current song _(1)_
- [ ] Venue anthem announcements _(1)_
- [ ] Estimated time until song plays from queue position + minutes saved if boosted _(2, new estimate)_
- ~~Next-song announcement~~ — dropped; Now Playing + Up Next lists already visible (see D5)

**Analytics (log only, no UI)**

- [ ] OpenAux-requested vs all songs played at venue _(1)_
- [ ] Revenue generated _(1)_
- [ ] Votes per song _(1)_
- [ ] Active users per venue _(1)_
- [ ] Track by geography/time/venue type: most requested songs, genre, real-time trends, skip rates _(3)_

### V1 — Fairness & drink-driven boosts

- [ ] Two-list queue display: "Up Next" (top 3, ordered) + larger randomized list of remaining songs _(2)_
- [ ] Reputation-based weighting v1: + upvotes received _(1)_, − spam attempts _(2)_, − songs skipped (venue skip or crowd-vote skip) _(1)_, − downvotes received _(1)_
- [ ] Crowd-voted skip mechanism for now-playing song _(1)_
- [ ] Anti-spam suite _(8)_:
  - [ ] Location verification within radius of venue _(5)_ (sensitive — request location only at join, explain why)
  - [ ] Min-vote threshold to play, active only when ≥10 active users; fallback to venue playlist, never silence (see D3)
  - [ ] Same song requested by multiple independent users counts 1.5× an upvote
  - [ ] 70%-of-active-users demand override — plays regardless of threshold
- [ ] Group-abuse detection _(8, can slip to V2)_: same arrival time _(2)_, WiFi/BT proximity over time _(8)_, social graph _(5)_, correlated voting patterns _(5)_
- [ ] Instant Play Vote $3 — ≈10 votes instantly, capped so crowd can override; switch scoring to capped model (§4 V1+) _(3)_
- [ ] Power Hour Mode — venue manually activates genre boost from drink totals (e.g. Hip-Hop ×2 votes for 15 min) + "🔥 Boosted by 4 Tequila Shots" display _(5, new estimate)_
- [ ] Boost Codes — venue generates promo codes for qualifying purchases; app-regulated credit tiers (Beer +1, Cocktail +2, Bottle service +10); codes expire 30 min after issue (see D7) _(5, new estimate)_
- [ ] Venue-abuse dispute system _(13 — needs discussion, keep behind flag)_
- [ ] Monetization UI: "Instant Play Vote for $3" (naming resolved, see D4)

### V2 — Reputation depth & premium

- [ ] Reputation v2: + songs played, + time in venue — reward all engagement
- [ ] Premium user = anyone who purchased a paid option that night at that venue (see D8) → max 5 active requests
- [ ] Super Boost $5 — front of queue if ≥30% positive ratio; implemented as flag "if #1-eligible, picked next" _(from algorithm §6)_
- [ ] Monetization UI: "Super Boost for $5"
- [ ] Venue dashboard: Crowd Mood Detection (skip rate, vote velocity, time of night, genre engagement → "Crowd energy: HIGH / Trending: Afrobeat / Low: house")

### V3 — Social & data products

- [ ] Reputation v3: + crowd reactions on your songs, + unique song requests
- [ ] "Beat the Song Above You" dynamic pricing UI (Beat #3 for $1.20…)
- [ ] Vibe Score — realtime now-playing reactions (🔥 Fire / 🕺 Danceable / 😐 Mid / 👎 Skip) with floating animations + percentage summary; optional venue display
- [ ] Analytics UI for record labels/DJs: most-requested, genre, club trends, skip rates by geography/time/venue type

### V4 — Competition & promotions

- [ ] Dynamic credit pricing by demand (active users × engagement), with price caps
- [ ] Brand promotions ("Sponsored by Red Bull — free shot at 100 votes")
- [ ] Leaderboard — Top DJs Tonight; venue/geo-specific; tonight/weekly/all-time; rewards for leaders
- [ ] Cross-venue competition (brand-sponsored rewards)
- [ ] Pass the Aux — every ~20 min, pick a temporary crowd DJ (random among top influence scores of the night) who queues 1 guaranteed next song; "🔥 Alex has the AUX" display

### V5 — Discovery & profiles

- [ ] Live city dashboard: "Where music is good tonight" (positive-engagement metric, avoid crowding out small venues), "Where this genre is popular," "Try this tonight" (influence-score incentives for lesser-known venues; some moderated/sponsored)
- [ ] Social profiles, opt-in public: genre tastes, most-requested songs/artists. Influence scores never public (anti-shaming)
- [ ] Demographic-tied analytics for labels/DJs

### V6 — AI & ads

- [ ] AI Auto Queue — song selection for continuity: votes, tempo, genre continuity, key compatibility, crowd reactions, time of night, venue preference/location
- [ ] Ad monetization

---

## 6. UI Requirements Summary

- **Patron**: search + request; queue with Up Next 3 + randomized rest; my-song position + boost CTAs contextual to moments users spend (song close to playing, someone else boosted, beating another user); vote buttons; reactions (V3); transparency panel — "Crowd Support 12👍/3👎, Boost Power 6/6 (max), Eligible: Yes, Est. position #4." People accept monetization when rules are visible.
- **Venue**: session start (provider connect, playlist load, QR display); control mode toggle; block management; override/manual play; anthem + Power Hour + Boost Code management; dashboards (V2+).
- **Shared displays**: Now Playing + DJ attribution, anthem banners, Power Hour banners.

## 7. Non-Functional Requirements

- Score recompute on every vote/boost/request event, or every few seconds per venue; must handle a bar-sized session (~200 active users) per venue.
- Analytics writes must never block queue operations (async event pipeline).
- All weights/thresholds/caps per-venue configurable with global defaults; design for A/B testing by venue type (dive bar vs club).
- Location data is sensitive: request only at venue join, state the purpose, never store precise history (Sensitivities note in doc).
- Idempotent payment handling; every paid action reconciles in the credits ledger.

## 8. Suggested Build Order (agent workstreams)

1. **Foundation**: data model, auth + guest sessions, venue setup + QR join, realtime channel.
2. **Music provider layer**: Spotify + Apple Music adapters, search, venue playback device.
3. **Queue core**: requests, votes, V0 scoring engine, eligibility layer, DJ-brain selection, venue playlist fallback.
4. **Venue controls**: modes, blocks, overrides, announcements.
5. **Monetization**: payments, credits ledger, Priority Boost, refunds, anthem, monetization UI.
6. **Anti-spam & analytics**: cooldowns, session expiry, event logging.
7. Then V1 items in listed order.

## 9. Decisions Made on Ambiguities (log)

| #   | Ambiguity in original doc                                                          | Decision                                                                                                                                                                                                          |
| --- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Two scoring formulas (Hermann's V0 vs "Possible Algorithm Logic")                  | V0 ships Hermann's simple additive formula. The capped paid-points model + guardrails is the V1 evolution once Instant Play Vote exists. One engine, versioned weights.                                           |
| D2  | "How much paid-boosts" — Clarify                                                   | PriorityBoostWeight = 3 per boost in V0 (≈3 votes per $1). V1+: paid-point mapping $1/+1, $3/+4, $5/+7 with 25–40% cap.                                                                                           |
| D3  | Min vote threshold to play — "no songs play if not enough votes? seems too harsh"  | Threshold active only when ≥10 active users. Below that, no gate. If no song passes, fall back to venue playlist — the room is never silent. 70%-of-actives demand overrides the gate.                            |
| D4  | "Instant Vote or Instant Play?"                                                    | Canonical name: **Instant Play Vote** ($3), everywhere including UI.                                                                                                                                              |
| D5  | Does "next song" need announcing if Now Playing/Up Next visible?                   | No. Dropped. DJ-attribution and anthem announcements kept.                                                                                                                                                        |
| D6  | Tempo-range blocking "not as easy as it sounds" (BPM ≠ vibe)                       | Deferred out of V0 venue blocks. BPM/energy handled properly in V6 AI Auto Queue using provider audio features + genre together.                                                                                  |
| D7  | Boost Code implementation "needs discussion"; "credit-to-cost has to be regulated" | Venue dashboard generates single-use codes from app-fixed tiers (Beer +1 / Cocktail +2 / Bottle +10); venues choose which tier per product but not arbitrary amounts. 30-min expiry. Receipt-QR variant deferred. |
| D8  | How is "premium" defined?                                                          | Purchase of any paid option that night at that venue (doc's own lean — better monetization), not influence score.                                                                                                 |
| D9  | Pass the Aux selection rule                                                        | Random draw among the night's top influence scores (doc's suggested answer). Every 20 min, 1 guaranteed song.                                                                                                     |
| D10 | Group detection via Instagram mutual friends                                       | Rejected for privacy/feasibility. Use arrival time, proximity, and voting-pattern correlation instead (V1/V2).                                                                                                    |
| D11 | Venue blocking "defeats the whole point"?                                          | Keep blocks but make them visible in-app ("This venue doesn't play X") so expectations are set; Suggestion mode is the stricter alternative for control-heavy venues.                                             |
| D12 | Super Boost 30% ratio vs algorithm's 60% eligibility gate                          | Both: 60% is the general playability gate at scale (≥10 actives); 30% is Super Boost's own floor. Super Boost never overrides crowd hate.                                                                         |
| D13 | Spotify/Apple Music integration absent from doc                                    | Added §2: provider abstraction, venue-device playback authority, Premium-account requirement per venue.                                                                                                           |
| D14 | Refund shouldn't erase engagement                                                  | Refund goes to account credit automatically at session end; the attempt still logs to analytics and reputation history.                                                                                           |
| D15 | Revenue split                                                                      | 70% venue / 30% app (doc's parenthetical), configurable per contract.                                                                                                                                             |
