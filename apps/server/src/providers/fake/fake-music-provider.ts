import type { MusicProvider, MusicProviderId, NowPlayingState, PlaybackTarget, Track } from '@openaux/shared';

interface FakeCatalogEntry {
  providerTrackId: string;
  title: string;
  artist: string;
  album: string | null;
  durationMs: number;
  explicit: boolean;
  genres: string[];
  artworkUrl: string | null;
}

interface FakePlaybackState {
  track: Track | null;
  queuedTracks: Track[];
  positionMs: number;
  isPlaying: boolean;
}

const FAKE_CATALOG: FakeCatalogEntry[] = [
  {
    providerTrackId: 'fake-track-001',
    title: 'Neon Hearts',
    artist: 'The Midnight Echo',
    album: 'After Hours',
    durationMs: 212_000,
    explicit: false,
    genres: ['synthpop', 'pop'],
    artworkUrl: 'https://fake.openaux.local/artwork/neon-hearts.jpg',
  },
  {
    providerTrackId: 'fake-track-002',
    title: 'Basement Anthem',
    artist: 'Low End Theory',
    album: 'Concrete Pulse',
    durationMs: 189_000,
    explicit: true,
    genres: ['hip-hop', 'rap'],
    artworkUrl: 'https://fake.openaux.local/artwork/basement-anthem.jpg',
  },
  {
    providerTrackId: 'fake-track-003',
    title: 'Velvet Sunrise',
    artist: 'Sofia Vale',
    album: 'Golden Hour',
    durationMs: 241_000,
    explicit: false,
    genres: ['r&b', 'soul'],
    artworkUrl: 'https://fake.openaux.local/artwork/velvet-sunrise.jpg',
  },
  {
    providerTrackId: 'fake-track-004',
    title: 'Static on the Dancefloor',
    artist: 'Circuit Bloom',
    album: 'Voltage',
    durationMs: 205_000,
    explicit: false,
    genres: ['dance', 'electronic'],
    artworkUrl: 'https://fake.openaux.local/artwork/static-on-the-dancefloor.jpg',
  },
  {
    providerTrackId: 'fake-track-005',
    title: 'Midnight Mile',
    artist: 'Kings of Saturday',
    album: 'City Lights',
    durationMs: 233_000,
    explicit: false,
    genres: ['rock', 'indie'],
    artworkUrl: 'https://fake.openaux.local/artwork/midnight-mile.jpg',
  },
  {
    providerTrackId: 'fake-track-006',
    title: 'Southside Sermon',
    artist: 'Jax Monroe',
    album: 'Late Checkout',
    durationMs: 176_000,
    explicit: true,
    genres: ['hip-hop', 'trap'],
    artworkUrl: 'https://fake.openaux.local/artwork/southside-sermon.jpg',
  },
  {
    providerTrackId: 'fake-track-007',
    title: 'Palm Tree Static',
    artist: 'Marina Daze',
    album: 'Salt Air',
    durationMs: 198_000,
    explicit: false,
    genres: ['reggaeton', 'latin'],
    artworkUrl: 'https://fake.openaux.local/artwork/palm-tree-static.jpg',
  },
  {
    providerTrackId: 'fake-track-008',
    title: 'Paper Planes Home',
    artist: 'Ari Lennoxx',
    album: 'Window Seat',
    durationMs: 221_000,
    explicit: false,
    genres: ['pop', 'indie'],
    artworkUrl: 'https://fake.openaux.local/artwork/paper-planes-home.jpg',
  },
  {
    providerTrackId: 'fake-track-009',
    title: 'Chrome Cowboy',
    artist: 'Dakota Lane',
    album: 'Interstate Dreams',
    durationMs: 214_000,
    explicit: false,
    genres: ['country', 'americana'],
    artworkUrl: 'https://fake.openaux.local/artwork/chrome-cowboy.jpg',
  },
  {
    providerTrackId: 'fake-track-010',
    title: 'Blue Room Theory',
    artist: 'Harlem Static',
    album: 'Night Shift',
    durationMs: 248_000,
    explicit: false,
    genres: ['jazz', 'neo-soul'],
    artworkUrl: 'https://fake.openaux.local/artwork/blue-room-theory.jpg',
  },
  {
    providerTrackId: 'fake-track-011',
    title: 'Afterparty Gospel',
    artist: 'Nova Youth',
    album: 'Bright Damage',
    durationMs: 201_000,
    explicit: true,
    genres: ['pop-punk', 'rock'],
    artworkUrl: 'https://fake.openaux.local/artwork/afterparty-gospel.jpg',
  },
  {
    providerTrackId: 'fake-track-012',
    title: 'Mirrors in Motion',
    artist: 'Luna Harbor',
    album: 'Reflections',
    durationMs: 227_000,
    explicit: false,
    genres: ['electronic', 'house'],
    artworkUrl: 'https://fake.openaux.local/artwork/mirrors-in-motion.jpg',
  },
  {
    providerTrackId: 'fake-track-013',
    title: 'Whiskey in the Neon',
    artist: 'Rosie Quartz',
    album: 'Last Call',
    durationMs: 193_000,
    explicit: false,
    genres: ['country', 'pop'],
    artworkUrl: 'https://fake.openaux.local/artwork/whiskey-in-the-neon.jpg',
  },
  {
    providerTrackId: 'fake-track-014',
    title: 'Broken Halo',
    artist: 'Saint Avenue',
    album: 'Runner',
    durationMs: 238_000,
    explicit: true,
    genres: ['rock', 'alternative'],
    artworkUrl: 'https://fake.openaux.local/artwork/broken-halo.jpg',
  },
  {
    providerTrackId: 'fake-track-015',
    title: 'Cali Heatwave',
    artist: 'Sol & The Tide',
    album: 'Pacific Motion',
    durationMs: 184_000,
    explicit: false,
    genres: ['latin', 'dance'],
    artworkUrl: 'https://fake.openaux.local/artwork/cali-heatwave.jpg',
  },
  {
    providerTrackId: 'fake-track-016',
    title: 'Velour Fever',
    artist: 'Mona Saint',
    album: 'Silk District',
    durationMs: 216_000,
    explicit: false,
    genres: ['disco', 'funk'],
    artworkUrl: 'https://fake.openaux.local/artwork/velour-fever.jpg',
  },
  {
    providerTrackId: 'fake-track-017',
    title: 'Underground Weather',
    artist: 'Metro Hollow',
    album: 'Signals',
    durationMs: 229_000,
    explicit: false,
    genres: ['indie', 'alternative'],
    artworkUrl: 'https://fake.openaux.local/artwork/underground-weather.jpg',
  },
  {
    providerTrackId: 'fake-track-018',
    title: 'Gold Teeth Prayer',
    artist: 'Rico Valez',
    album: 'Phone Lights',
    durationMs: 171_000,
    explicit: true,
    genres: ['rap', 'latin trap'],
    artworkUrl: 'https://fake.openaux.local/artwork/gold-teeth-prayer.jpg',
  },
  {
    providerTrackId: 'fake-track-019',
    title: 'Moonroof Memories',
    artist: 'Cassie June',
    album: 'Open Roads',
    durationMs: 224_000,
    explicit: false,
    genres: ['pop', 'dance'],
    artworkUrl: 'https://fake.openaux.local/artwork/moonroof-memories.jpg',
  },
  {
    providerTrackId: 'fake-track-020',
    title: 'Slow Burn Cinema',
    artist: 'The Borough Keys',
    album: 'Film Grain',
    durationMs: 245_000,
    explicit: false,
    genres: ['soul', 'funk'],
    artworkUrl: 'https://fake.openaux.local/artwork/slow-burn-cinema.jpg',
  },
];

const playbackStates = new Map<string, FakePlaybackState>();

function toTrack(entry: FakeCatalogEntry, provider: MusicProviderId): Track {
  return {
    provider,
    providerTrackId: entry.providerTrackId,
    title: entry.title,
    artist: entry.artist,
    album: entry.album,
    durationMs: entry.durationMs,
    explicit: entry.explicit,
    genres: [...entry.genres],
    artworkUrl: entry.artworkUrl,
  };
}

function cloneTrack(track: Track | null): Track | null {
  if (!track) return null;
  return { ...track, genres: [...track.genres] };
}

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

export class FakeMusicProvider implements MusicProvider {
  readonly id: MusicProviderId;

  private readonly catalog: Track[];

  constructor(providerId: MusicProviderId) {
    this.id = providerId;
    this.catalog = FAKE_CATALOG.map((entry) => toTrack(entry, providerId));
  }

  async searchTracks(query: string, opts?: { limit?: number }): Promise<Track[]> {
    const limit = Math.max(0, opts?.limit ?? 20);
    const terms = normalize(query).split(/\s+/).filter(Boolean);
    const matches =
      terms.length === 0
        ? this.catalog
        : this.catalog.filter((track) => {
            const haystack = normalize(
              [track.title, track.artist, track.album ?? '', ...track.genres].join(' '),
            );
            return terms.every((term) => haystack.includes(term));
          });

    return matches.slice(0, limit).map((track) => cloneTrack(track) as Track);
  }

  async getTrack(providerTrackId: string): Promise<Track | null> {
    return cloneTrack(
      this.catalog.find((track) => track.providerTrackId === providerTrackId) ?? null,
    );
  }

  async queueNext(target: PlaybackTarget, track: Track): Promise<void> {
    const state = this.getPlaybackState(target);
    state.queuedTracks.push({ ...track, provider: this.id, genres: [...track.genres] });
  }

  async play(target: PlaybackTarget): Promise<void> {
    const state = this.getPlaybackState(target);
    if (!state.track) {
      state.track = state.queuedTracks.shift() ?? null;
      state.positionMs = 0;
    }
    state.isPlaying = state.track !== null;
  }

  async pause(target: PlaybackTarget): Promise<void> {
    const state = this.getPlaybackState(target);
    state.isPlaying = false;
  }

  async skip(target: PlaybackTarget): Promise<void> {
    const state = this.getPlaybackState(target);
    state.track = state.queuedTracks.shift() ?? null;
    state.positionMs = 0;
    state.isPlaying = state.track !== null;
  }

  async getNowPlaying(target: PlaybackTarget): Promise<NowPlayingState> {
    const state = this.getPlaybackState(target);
    return {
      track: cloneTrack(state.track),
      positionMs: state.positionMs,
      isPlaying: state.isPlaying,
    };
  }

  private getPlaybackState(target: PlaybackTarget): FakePlaybackState {
    const key = `${this.id}:${target.venueId}`;
    const existing = playbackStates.get(key);
    if (existing) return existing;

    const created: FakePlaybackState = {
      track: null,
      queuedTracks: [],
      positionMs: 0,
      isPlaying: false,
    };
    playbackStates.set(key, created);
    return created;
  }
}
