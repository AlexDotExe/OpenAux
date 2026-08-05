/**
 * Auth verification seam (SPEC.md §2, §5 "User sign-in").
 *
 * V0 ships guest-only join over the wire; this interface is the clean seam
 * for wiring real Apple / Google / phone verification later without
 * touching join logic in service.ts. See CONTRACTS.md — JoinSessionRequest
 * carries an opaque `authToken`; how that token is minted client-side
 * (Sign in with Apple, Google ID token, phone OTP) is out of scope here.
 */

export interface VerifiedIdentity {
  provider: 'apple' | 'google' | 'phone';
  /** Provider-side subject id — stored in users.auth_subject. */
  subject: string;
  displayName: string;
}

export interface AuthVerifier {
  /** Verify an opaque authToken from POST /api/sessions/join. Throws AuthVerificationError on failure. */
  verify(authToken: string): Promise<VerifiedIdentity>;
}

export class AuthVerificationError extends Error {}

/**
 * TODO(maintainer): wire real Apple/Google/phone verification here (Sign in
 * with Apple JWT verification, Google ID token verification, phone OTP
 * check). This stub always rejects so authToken-bearing joins fail loudly
 * with `unauthorized` instead of silently downgrading to a guest identity.
 */
export const unimplementedAuthVerifier: AuthVerifier = {
  async verify(): Promise<VerifiedIdentity> {
    throw new AuthVerificationError('Auth provider verification is not implemented yet');
  },
};
