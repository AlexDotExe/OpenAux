/**
 * Static seed data for the mock API client. Not a contract file — just demo
 * content so every screen has something to render with NEXT_PUBLIC_API_MOCK=1.
 */

import type { MusicProviderId, Track, VenueControlMode } from '@openaux/shared';

const PROVIDER: MusicProviderId = 'spotify';

function track(
  providerTrackId: string,
  title: string,
  artist: string,
  album: string,
  durationMs: number,
  explicit: boolean,
  genres: string[],
): Track {
  return {
    provider: PROVIDER,
    providerTrackId,
    title,
    artist,
    album,
    durationMs,
    explicit,
    genres,
    artworkUrl: null,
  };
}

export const CATALOG: Track[] = [
  track('t-blinding-lights', 'Blinding Lights', 'The Weeknd', 'After Hours', 200040, false, [
    'synth-pop',
  ]),
  track('t-levitating', 'Levitating', 'Dua Lipa', 'Future Nostalgia', 203064, false, [
    'pop',
    'disco',
  ]),
  track('t-industry-baby', 'Industry Baby', 'Lil Nas X', 'Montero', 212000, true, [
    'hip-hop',
    'pop',
  ]),
  track('t-flowers', 'Flowers', 'Miley Cyrus', 'Endless Summer Vacation', 200600, false, ['pop']),
  track('t-as-it-was', 'As It Was', 'Harry Styles', "Harry's House", 167000, false, [
    'pop',
    'synth-pop',
  ]),
  track('t-good-4-u', 'good 4 u', 'Olivia Rodrigo', 'SOUR', 178000, true, ['pop-punk', 'pop']),
  track('t-heat-waves', 'Heat Waves', 'Glass Animals', 'Dreamland', 238000, false, [
    'indie',
    'psychedelic-pop',
  ]),
  track('t-sicko-mode', 'SICKO MODE', 'Travis Scott', 'Astroworld', 312000, true, [
    'hip-hop',
    'trap',
  ]),
  track('t-dance-monkey', 'Dance Monkey', 'Tones and I', 'The Kids Are Coming', 209000, false, [
    'pop',
    'dance',
  ]),
  track('t-blueberry-faygo', 'Blueberry Faygo', 'Lil Mosey', 'Certified Hitmaker', 149000, true, [
    'hip-hop',
    'trap',
  ]),
  track('t-dont-start-now', "Don't Start Now", 'Dua Lipa', 'Future Nostalgia', 183000, false, [
    'dance-pop',
    'disco',
  ]),
  track('t-shivers', 'Shivers', 'Ed Sheeran', '=', 207000, false, ['pop']),
  track('t-cant-hold-us', "Can't Hold Us", 'Macklemore & Ryan Lewis', 'The Heist', 258000, false, [
    'hip-hop',
  ]),
  track('t-titi-me-pregunto', 'Tití Me Preguntó', 'Bad Bunny', 'Un Verano Sin Ti', 244000, true, [
    'reggaeton',
    'latin',
  ]),
  track('t-unholy', 'Unholy', 'Sam Smith ft. Kim Petras', 'Gloria', 156000, true, ['pop', 'dance']),
  track(
    't-get-lucky',
    'Get Lucky',
    'Daft Punk ft. Pharrell',
    'Random Access Memories',
    369000,
    false,
    ['funk', 'disco'],
  ),
];

export function findTrack(providerTrackId: string): Track | null {
  return CATALOG.find((t) => t.providerTrackId === providerTrackId) ?? null;
}

export interface MockVenueRecord {
  venueId: string;
  name: string;
  musicProvider: MusicProviderId;
  controlMode: VenueControlMode;
  qrToken: string;
  blockExplicit: boolean;
  blockedGenres: string[];
  blockedArtists: string[];
  /** Demo-only "auth" — see contract-gap note in lib/api.ts. */
  adminToken: string;
  fallbackPlaylistTrackIds: string[];
  anthem: { providerTrackId: string; promoText: string; promoDurationMinutes: number } | null;
}

export function makeDemoVenue(): MockVenueRecord {
  return {
    venueId: 'venue-1',
    name: 'The Rooftop',
    musicProvider: 'spotify',
    controlMode: 'crowd',
    qrToken: 'demo-qr-token',
    blockExplicit: false,
    blockedGenres: [],
    blockedArtists: [],
    adminToken: 'demo-admin-token',
    fallbackPlaylistTrackIds: ['t-get-lucky', 't-dont-start-now'],
    anthem: null,
  };
}

export const SEED_USERS: Record<string, string> = {
  'seed-user-jordan': 'Jordan',
  'seed-user-alex': 'Alex',
  'seed-user-sam': 'Sam',
  'seed-user-riley': 'Riley',
};
