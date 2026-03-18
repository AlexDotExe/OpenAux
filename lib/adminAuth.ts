import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';

export type AdminOAuthProvider = 'spotify' | 'google';
export type AdminOAuthAction = 'signin' | 'connect';

export interface AdminOAuthState {
  action: AdminOAuthAction;
  provider: AdminOAuthProvider;
  venueId?: string;
  nonce: string;
}

interface PendingAdminSession {
  venueId: string;
  authToken: string;
  provider: AdminOAuthProvider;
  connectedProvider?: string;
}

interface PendingAdminOnboarding {
  provider: AdminOAuthProvider;
  providerUserId: string;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt: string;
  scope?: string | null;
  connectedAccountName?: string | null;
  connectedAccountEmail?: string | null;
}

const isProduction = process.env.NODE_ENV === 'production';
const baseCookieOptions = {
  path: '/',
  sameSite: 'lax' as const,
  secure: isProduction,
};

export const ADMIN_OAUTH_STATE_COOKIE = '_admin_oauth_state';
export const PENDING_ADMIN_AUTH_TOKEN_COOKIE = '_pending_admin_auth_token';
export const PENDING_ADMIN_AUTH_VENUE_COOKIE = '_pending_admin_auth_venue';
export const PENDING_ADMIN_AUTH_PROVIDER_COOKIE = '_pending_admin_auth_provider';
export const PENDING_ADMIN_AUTH_CONNECTED_COOKIE = '_pending_admin_connected_provider';

const PENDING_ADMIN_ONBOARDING_PROVIDER_COOKIE = '_pending_admin_onboarding_provider';
const PENDING_ADMIN_ONBOARDING_PROVIDER_ID_COOKIE = '_pending_admin_onboarding_provider_id';
const PENDING_ADMIN_ONBOARDING_ACCESS_COOKIE = '_pending_admin_onboarding_access_token';
const PENDING_ADMIN_ONBOARDING_REFRESH_COOKIE = '_pending_admin_onboarding_refresh_token';
const PENDING_ADMIN_ONBOARDING_EXPIRES_COOKIE = '_pending_admin_onboarding_expires_at';
const PENDING_ADMIN_ONBOARDING_SCOPE_COOKIE = '_pending_admin_onboarding_scope';
const PENDING_ADMIN_ONBOARDING_NAME_COOKIE = '_pending_admin_onboarding_name';
const PENDING_ADMIN_ONBOARDING_EMAIL_COOKIE = '_pending_admin_onboarding_email';

export function createAdminOAuthState(
  action: AdminOAuthAction,
  provider: AdminOAuthProvider,
  venueId?: string,
): string {
  return Buffer.from(
    JSON.stringify({
      action,
      provider,
      venueId,
      nonce: uuidv4(),
    } satisfies AdminOAuthState),
  ).toString('base64url');
}

export function parseAdminOAuthState(state: string | null): AdminOAuthState | null {
  if (!state) return null;

  try {
    return JSON.parse(Buffer.from(state, 'base64url').toString('utf-8')) as AdminOAuthState;
  } catch {
    return null;
  }
}

export function setAdminOAuthStateCookie(response: NextResponse, state: string): void {
  response.cookies.set(ADMIN_OAUTH_STATE_COOKIE, state, {
    ...baseCookieOptions,
    httpOnly: true,
    maxAge: 60 * 10,
  });
}

export function clearAdminOAuthStateCookie(response: NextResponse): void {
  response.cookies.set(ADMIN_OAUTH_STATE_COOKIE, '', {
    ...baseCookieOptions,
    httpOnly: true,
    maxAge: 0,
  });
}

export function setPendingAdminSessionCookies(
  response: NextResponse,
  session: PendingAdminSession,
): void {
  response.cookies.set(PENDING_ADMIN_AUTH_TOKEN_COOKIE, session.authToken, {
    ...baseCookieOptions,
    httpOnly: false,
    maxAge: 60,
  });
  response.cookies.set(PENDING_ADMIN_AUTH_VENUE_COOKIE, session.venueId, {
    ...baseCookieOptions,
    httpOnly: false,
    maxAge: 60,
  });
  response.cookies.set(PENDING_ADMIN_AUTH_PROVIDER_COOKIE, session.provider, {
    ...baseCookieOptions,
    httpOnly: false,
    maxAge: 60,
  });
  if (session.connectedProvider) {
    response.cookies.set(PENDING_ADMIN_AUTH_CONNECTED_COOKIE, session.connectedProvider, {
      ...baseCookieOptions,
      httpOnly: false,
      maxAge: 60,
    });
  }
}

export function clearPendingAdminSessionCookies(response: NextResponse): void {
  for (const name of [
    PENDING_ADMIN_AUTH_TOKEN_COOKIE,
    PENDING_ADMIN_AUTH_VENUE_COOKIE,
    PENDING_ADMIN_AUTH_PROVIDER_COOKIE,
    PENDING_ADMIN_AUTH_CONNECTED_COOKIE,
  ]) {
    response.cookies.set(name, '', {
      ...baseCookieOptions,
      httpOnly: false,
      maxAge: 0,
    });
  }
}

export function setPendingAdminOnboardingCookies(
  response: NextResponse,
  data: PendingAdminOnboarding,
): void {
  response.cookies.set(PENDING_ADMIN_ONBOARDING_PROVIDER_COOKIE, data.provider, {
    ...baseCookieOptions,
    httpOnly: true,
    maxAge: 60 * 10,
  });
  response.cookies.set(PENDING_ADMIN_ONBOARDING_PROVIDER_ID_COOKIE, data.providerUserId, {
    ...baseCookieOptions,
    httpOnly: true,
    maxAge: 60 * 10,
  });
  response.cookies.set(PENDING_ADMIN_ONBOARDING_ACCESS_COOKIE, data.accessToken, {
    ...baseCookieOptions,
    httpOnly: true,
    maxAge: 60 * 10,
  });
  response.cookies.set(PENDING_ADMIN_ONBOARDING_EXPIRES_COOKIE, data.expiresAt, {
    ...baseCookieOptions,
    httpOnly: true,
    maxAge: 60 * 10,
  });

  if (data.refreshToken) {
    response.cookies.set(PENDING_ADMIN_ONBOARDING_REFRESH_COOKIE, data.refreshToken, {
      ...baseCookieOptions,
      httpOnly: true,
      maxAge: 60 * 10,
    });
  }
  if (data.scope) {
    response.cookies.set(PENDING_ADMIN_ONBOARDING_SCOPE_COOKIE, data.scope, {
      ...baseCookieOptions,
      httpOnly: true,
      maxAge: 60 * 10,
    });
  }
  if (data.connectedAccountName) {
    response.cookies.set(PENDING_ADMIN_ONBOARDING_NAME_COOKIE, data.connectedAccountName, {
      ...baseCookieOptions,
      httpOnly: true,
      maxAge: 60 * 10,
    });
  }
  if (data.connectedAccountEmail) {
    response.cookies.set(PENDING_ADMIN_ONBOARDING_EMAIL_COOKIE, data.connectedAccountEmail, {
      ...baseCookieOptions,
      httpOnly: true,
      maxAge: 60 * 10,
    });
  }
}

export function clearPendingAdminOnboardingCookies(response: NextResponse): void {
  for (const name of [
    PENDING_ADMIN_ONBOARDING_PROVIDER_COOKIE,
    PENDING_ADMIN_ONBOARDING_PROVIDER_ID_COOKIE,
    PENDING_ADMIN_ONBOARDING_ACCESS_COOKIE,
    PENDING_ADMIN_ONBOARDING_REFRESH_COOKIE,
    PENDING_ADMIN_ONBOARDING_EXPIRES_COOKIE,
    PENDING_ADMIN_ONBOARDING_SCOPE_COOKIE,
    PENDING_ADMIN_ONBOARDING_NAME_COOKIE,
    PENDING_ADMIN_ONBOARDING_EMAIL_COOKIE,
  ]) {
    response.cookies.set(name, '', {
      ...baseCookieOptions,
      httpOnly: true,
      maxAge: 0,
    });
  }
}

export function getPendingAdminOnboarding(
  cookies: { get(name: string): { value: string } | undefined },
): PendingAdminOnboarding | null {
  const provider = cookies.get(PENDING_ADMIN_ONBOARDING_PROVIDER_COOKIE)?.value as AdminOAuthProvider | undefined;
  const providerUserId = cookies.get(PENDING_ADMIN_ONBOARDING_PROVIDER_ID_COOKIE)?.value;
  const accessToken = cookies.get(PENDING_ADMIN_ONBOARDING_ACCESS_COOKIE)?.value;
  const expiresAt = cookies.get(PENDING_ADMIN_ONBOARDING_EXPIRES_COOKIE)?.value;

  if (!provider || !providerUserId || !accessToken || !expiresAt) {
    return null;
  }

  return {
    provider,
    providerUserId,
    accessToken,
    refreshToken: cookies.get(PENDING_ADMIN_ONBOARDING_REFRESH_COOKIE)?.value ?? null,
    expiresAt,
    scope: cookies.get(PENDING_ADMIN_ONBOARDING_SCOPE_COOKIE)?.value ?? null,
    connectedAccountName: cookies.get(PENDING_ADMIN_ONBOARDING_NAME_COOKIE)?.value ?? null,
    connectedAccountEmail: cookies.get(PENDING_ADMIN_ONBOARDING_EMAIL_COOKIE)?.value ?? null,
  };
}
