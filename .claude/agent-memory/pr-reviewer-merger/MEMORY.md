# PR Review and Merge Memory

## Common Patterns Observed

### Database Schema Changes
- PRs with Prisma schema changes require `npx prisma generate` after checkout
- Schema conflicts are common when multiple PRs modify the same models
- Always regenerate Prisma client before running build tests

### Conflict Resolution Strategy
- Sponsor songs feature had two implementations (PR #38 basic, PR #41 advanced)
- Combined complementary features: `anthemAnnouncement` (upcoming) + `activePromotion` (active)
- Settings conflicts: always merge all feature flags rather than choosing one

### Build Testing
- Always run `npm run build` after checking out a PR
- Linting errors in unrelated files should not block merge
- TypeScript errors usually indicate missing Prisma regeneration

### Merge Conflicts Resolved
1. **PR #41**: Combined sponsor song routes and session data (both anthemAnnouncement and activePromotion)
2. **PR #43**: Merged playlist features with crowd control settings in venues.ts and settings route
3. **PR #44**: Combined analytics tracking with playlist isPreloaded checking in sessionService.ts
4. **PR #52**: Merged admin OAuth sign-in with credits system (async/await pattern + loadCreditTransactions)

## Project-Specific Merge Order
PRs were merged in this order to minimize conflicts:
1. #37 - Queue position display (clean)
2. #38 - Venue anthem announcements (clean)
3. #39 - Crowd Control mode (clean)
4. #41 - Sponsor songs with promotions (conflicts with #38, resolved by combining)
5. #42 - Boost prompt (clean)
6. #43 - Pre-loaded playlists (conflicts with settings, resolved)
7. #44 - Analytics enhancements (conflicts with sessionService, resolved)
8. #49 - Prepaid credits system (clean)
9. #50 - Refund mechanism (clean after #49)
10. #52 - Admin OAuth (conflicts with #49/#50, resolved)

## Key Takeaways
- Draft PRs need `gh pr ready` before merging
- Squash merge strategy used consistently (`--squash --delete-branch`)
- Schema PRs often have cascading dependencies
- Component-level conflicts (PlaylistManager vs SponsorSongsManager) should include both

## Payment & Refund Patterns
- Stripe operations (refunds) should execute BEFORE database updates (fail-fast)
- Use Prisma transactions to atomically update multiple tables (Payment + SongRequest)
- Fire-and-forget pattern (`.catch`) for refunds ensures queue operations aren't blocked
- Idempotency guards essential: check for existing refunds before processing
- Payment intent metadata must include `requestId` for validation
- Include REFUNDED status in payment queries to prevent double-refund attempts
- **Credit refunds**: Create CreditTransaction records for all refunds (ledger visibility)
- **Bulk refunds**: Process on session end for all unplayed boosted songs
- **Reputation penalty**: Apply score penalty weighted by song uniqueness (1/requestCount)

## Code Quality Standards Observed
- Comprehensive error logging for financial operations (reconciliation needs)
- Multiple validation checks before critical operations (boosts, refunds)
- Consistent authorization patterns across admin routes
- Frontend: accessibility with ARIA labels, keyboard navigation for payment UI
- Policy messaging displayed at both consideration (tooltip) and commitment (modal) points

## Authentication & Security Patterns (PR #46)
- **Password Security**: bcrypt with 12 rounds, timing-safe comparison to prevent user enumeration
- **Token Management**: UUID-based auth tokens, rotated on every sign-in, invalidated on sign-out
- **OAuth Security**: CSRF nonce protection via sessionStorage, short-lived cookies (60s) for token passing
- **Cookie Strategy**: Never expose tokens in URL params (browser history risk) - use httpOnly=false cookies for client consumption
- **Storage Strategy**: localStorage for "stay logged in", sessionStorage for temporary auth
- **Schema Design**: nullable deviceFingerprint allows auth users without device fingerprinting
- **Unique Constraints**: email, instagramId, spotifyUserId, authToken all have unique indexes
- **Environment Variables**: Separate SPOTIFY_USER_CLIENT_ID from SPOTIFY_CLIENT_ID (venue vs user OAuth apps)
- **Guest-First Design**: Authentication is fully optional, guest mode is default when scanning QR codes
- **OAuth Callback Pattern**: Base64-encoded state with returnUrl and nonce, verified on callback

## Admin OAuth Patterns (PR #52)
- **Unified OAuth**: Combines sign-in and streaming service connection in one flow
- **Three OAuth flows**: signin (existing venue), connect (link to venue), onboarding (new venue)
- **Account linking prevention**: One OAuth account maps to one venue (unique constraints)
- **CSRF protection**: Base64-encoded state with nonce, validated on callback
- **Cookie security**: Short-lived (60s) httpOnly cookies for token handoff
- **Token refresh**: Store refresh tokens for long-term streaming access
- **Suspense boundaries**: Required for useSearchParams in client components for static generation

## Credits System Patterns (PR #49)
- **Atomic operations**: Prisma transactions for balance updates prevent race conditions
- **Idempotency**: Check for duplicate processing before crediting balance
- **Security**: Validate payment intent ownership and type before crediting
- **Integration**: Credit-based boosts alongside Stripe payments in boost route
- **Transaction ledger**: All credit movements recorded with type (PURCHASE, BOOST_DEBIT, REFUND)
- **Admin visibility**: Venue admins can view credit transactions for their venue users

## Refund Mechanism Patterns (PR #50)
- **Stripe-first**: Execute Stripe refund before database updates (fail-fast)
- **Atomic DB updates**: Prisma transaction for payment + request + credit transaction
- **Bulk processing**: Automatically refund all unplayed boosts on session end
- **Fire-and-forget**: Session end refunds don't block with `.catch()`
- **User communication**: RefundPolicyNotice component explains policy clearly
- **Reconciliation logging**: Log Stripe-DB mismatches for manual resolution

## Next.js Build Patterns
- **useSearchParams**: Must be wrapped in Suspense boundary for static generation
- **Client components**: Use Suspense for dynamic route params/search params
- **Build errors**: Always check for missing Suspense boundaries in client components
