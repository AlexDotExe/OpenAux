// sessions — see ownership map in CLAUDE.md before editing (WS1: auth, guest identity, QR join, session lifecycle)

export { registerSessionRoutes } from './routes.js';
export type { RegisterSessionRoutesOptions } from './routes.js';

export { joinSession } from './service.js';
export type { JoinSessionDeps, JoinSessionResult } from './service.js';

export { isSessionExpired, sweepExpiredSessions, SESSION_EXPIRY_MS } from './lifecycle.js';
export type { SweepDeps, SweepRepository } from './lifecycle.js';

export { PgSessionRepository } from './repository.js';
export type { SessionRepository } from './repository.js';

export { unimplementedAuthVerifier, AuthVerificationError } from './auth.js';
export type { AuthVerifier, VerifiedIdentity } from './auth.js';

export { noopAnalyticsEmitter } from './analytics.js';
export type { AnalyticsEventEmitter, EmitAnalyticsEventInput } from './analytics.js';
