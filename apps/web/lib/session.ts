/**
 * Client-side persistence for patron sessions and venue admin tokens.
 *
 * Contract gap (see final report): the API surface has no documented auth
 * transport (header name / scheme) for either patron sessions or venue admin
 * calls. We assume `X-Session-Id` for patrons and `X-Venue-Admin-Token` for
 * venue console calls — see lib/api.ts. This module just persists whatever
 * the join/login flow returns so the rest of the app can read it back.
 */

import type { VenueControlMode } from '@openaux/shared';

const PATRON_KEY_PREFIX = 'openaux:patronSession:';
const VENUE_ADMIN_KEY_PREFIX = 'openaux:venueAdmin:';

export interface StoredPatronSession {
  sessionId: string;
  userId: string;
  venueId: string;
  venueName: string;
  controlMode: VenueControlMode;
}

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

export function savePatronSession(session: StoredPatronSession): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(`${PATRON_KEY_PREFIX}${session.venueId}`, JSON.stringify(session));
}

export function loadPatronSession(venueId: string): StoredPatronSession | null {
  if (!isBrowser()) return null;
  const raw = window.localStorage.getItem(`${PATRON_KEY_PREFIX}${venueId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredPatronSession;
  } catch {
    return null;
  }
}

export function clearPatronSession(venueId: string): void {
  if (!isBrowser()) return;
  window.localStorage.removeItem(`${PATRON_KEY_PREFIX}${venueId}`);
}

export function saveVenueAdminToken(venueId: string, token: string): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(`${VENUE_ADMIN_KEY_PREFIX}${venueId}`, token);
}

export function loadVenueAdminToken(venueId: string): string | null {
  if (!isBrowser()) return null;
  return window.localStorage.getItem(`${VENUE_ADMIN_KEY_PREFIX}${venueId}`);
}

export function clearVenueAdminToken(venueId: string): void {
  if (!isBrowser()) return;
  window.localStorage.removeItem(`${VENUE_ADMIN_KEY_PREFIX}${venueId}`);
}

// --- Venue-owner login: one bearer token authorizes every venue the owner runs.
const OWNER_AUTH_KEY = 'openaux:venueOwnerAuth';

export interface StoredOwnerAuth {
  token: string;
  email: string;
  displayName: string;
  expiresAt: string;
}

export function saveOwnerAuth(auth: StoredOwnerAuth): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(OWNER_AUTH_KEY, JSON.stringify(auth));
}

export function loadOwnerAuth(): StoredOwnerAuth | null {
  if (!isBrowser()) return null;
  const raw = window.localStorage.getItem(OWNER_AUTH_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredOwnerAuth;
    if (new Date(parsed.expiresAt).getTime() <= Date.now()) {
      window.localStorage.removeItem(OWNER_AUTH_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearOwnerAuth(): void {
  if (!isBrowser()) return;
  window.localStorage.removeItem(OWNER_AUTH_KEY);
}
