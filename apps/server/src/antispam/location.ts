/**
 * Location verification (SPEC.md §5 V1 anti-spam: "Location verification within
 * radius of venue"). PURE haversine distance + a geofence membership test.
 *
 * Sensitive data: patron coordinates are captured ONLY at join, with a stated
 * purpose (confirming presence within the venue geofence). They are never stored
 * as location history. This module only does the math; it holds no state.
 *
 * Wiring note: the join-time enforcement lives in apps/server/src/sessions/
 * (WS1), which this workstream does NOT own. See the report for the exact hook.
 */

/** Mean Earth radius in metres (WGS-84 spherical approximation). */
export const EARTH_RADIUS_M = 6_371_000;

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

/** A venue geofence; any null field means "no geofence configured". */
export interface VenueGeofence {
  latitude: number | null;
  longitude: number | null;
  geofenceRadiusM: number | null;
}

/** Patron coordinates captured at join; null when declined/unavailable. */
export interface PatronLocation {
  latitude: number | null;
  longitude: number | null;
}

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * PURE. Great-circle distance between two points in metres (haversine formula).
 */
export function haversineDistanceM(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * PURE. True when the patron is allowed to join under the venue's geofence:
 *  - No geofence configured (any of lat/lon/radius null) → allow (true).
 *  - Geofence configured but patron coords missing → cannot verify → deny (false).
 *  - Otherwise: within radius (inclusive of the boundary) → true.
 */
export function isWithinRadius(venue: VenueGeofence, patron: PatronLocation): boolean {
  if (venue.latitude == null || venue.longitude == null || venue.geofenceRadiusM == null) {
    return true;
  }
  if (patron.latitude == null || patron.longitude == null) {
    return false;
  }
  const distance = haversineDistanceM(
    { latitude: venue.latitude, longitude: venue.longitude },
    { latitude: patron.latitude, longitude: patron.longitude },
  );
  return distance <= venue.geofenceRadiusM;
}
