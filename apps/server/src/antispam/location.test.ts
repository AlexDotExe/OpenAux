import { describe, expect, it } from 'vitest';
import {
  haversineDistanceM,
  isWithinRadius,
  type VenueGeofence,
} from './location.js';

// A venue and points at known distances (approximate). One degree of latitude
// ≈ 111.19 km, so small offsets give predictable metre distances.
const venue: VenueGeofence = {
  latitude: 40.0,
  longitude: -73.0,
  geofenceRadiusM: 100,
};

describe('haversineDistanceM', () => {
  it('is 0 for identical points', () => {
    expect(haversineDistanceM({ latitude: 40, longitude: -73 }, { latitude: 40, longitude: -73 })).toBe(
      0,
    );
  });

  it('measures a ~111.2m north offset of 0.001 degrees latitude', () => {
    const d = haversineDistanceM(
      { latitude: 40.0, longitude: -73.0 },
      { latitude: 40.001, longitude: -73.0 },
    );
    expect(d).toBeGreaterThan(110);
    expect(d).toBeLessThan(112);
  });

  it('is symmetric', () => {
    const a = { latitude: 40, longitude: -73 };
    const b = { latitude: 41, longitude: -72 };
    expect(haversineDistanceM(a, b)).toBeCloseTo(haversineDistanceM(b, a), 6);
  });
});

describe('isWithinRadius', () => {
  it('allows when the venue has no geofence radius', () => {
    expect(isWithinRadius({ ...venue, geofenceRadiusM: null }, { latitude: 0, longitude: 0 })).toBe(
      true,
    );
  });

  it('allows when the venue has no coordinates', () => {
    expect(
      isWithinRadius({ latitude: null, longitude: null, geofenceRadiusM: 100 }, {
        latitude: 40,
        longitude: -73,
      }),
    ).toBe(true);
  });

  it('denies when geofenced but patron coordinates are missing', () => {
    expect(isWithinRadius(venue, { latitude: null, longitude: null })).toBe(false);
    expect(isWithinRadius(venue, { latitude: 40, longitude: null })).toBe(false);
  });

  it('allows a patron at the exact venue location', () => {
    expect(isWithinRadius(venue, { latitude: 40, longitude: -73 })).toBe(true);
  });

  it('allows just inside the radius', () => {
    // ~55.6m north (0.0005 deg) is inside a 100m geofence.
    expect(isWithinRadius(venue, { latitude: 40.0005, longitude: -73.0 })).toBe(true);
  });

  it('denies just outside the radius', () => {
    // ~111m north (0.001 deg) is outside a 100m geofence.
    expect(isWithinRadius(venue, { latitude: 40.001, longitude: -73.0 })).toBe(false);
  });

  it('treats the boundary as inside (inclusive)', () => {
    // Build a patron point whose distance equals the radius, then check <=.
    const patron = { latitude: 40.0, longitude: -73.0 };
    const exactRadius = haversineDistanceM(
      { latitude: venue.latitude!, longitude: venue.longitude! },
      patron,
    );
    expect(isWithinRadius({ ...venue, geofenceRadiusM: exactRadius }, patron)).toBe(true);
  });
});
