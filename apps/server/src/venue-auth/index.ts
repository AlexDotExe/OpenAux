/**
 * venue-auth/ — venue-operator accounts, admin sessions, and venue creation.
 *
 * Maintainer wiring (apps/server/src/index.ts):
 *   const repository = new PgVenueAuthRepository(pool);
 *   const verifier = createVenueAdminVerifier({ repository });
 *   await app.register(registerVenueAuthRoutes, { repository, verifier });
 * Then inject `verifier` into the venue/, providers/, and realtime/ guards so the
 * owner session token is the single venue-admin credential everywhere.
 */
export { PgVenueAuthRepository, DuplicateEmailError } from './repository.js';
export type { VenueAuthRepository, QueryablePool } from './repository.js';
export { VenueAuthService, VenueAuthError, SESSION_TTL_MS } from './service.js';
export { createVenueAdminVerifier } from './verifier.js';
export type { VenueAdminVerifier } from './verifier.js';
export { registerVenueAuthRoutes } from './routes.js';
export type { VenueAuthRoutesOptions } from './routes.js';
export {
  hashPassword,
  verifyPassword,
  hashToken,
  generateSessionToken,
  timingSafeStringEquals,
} from './crypto.js';
