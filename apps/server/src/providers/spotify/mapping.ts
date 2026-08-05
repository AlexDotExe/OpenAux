/**
 * Maps raw Spotify Web API JSON shapes to the shared Track type.
 *
 * Note: Spotify track objects do not carry genre — genre lives on the
 * *artist* resource. To map `genres` faithfully we batch-fetch genres for
 * the primary artist of each track via GET /v1/artists?ids=... and attach
 * them. See SpotifyProvider for the batching call site.
 */
import type { Track } from '@openaux/shared';

export interface SpotifyArtistRef {
  id: string;
  name: string;
}

export interface SpotifyImage {
  url: string;
  width: number | null;
  height: number | null;
}

export interface SpotifyTrackJson {
  id: string;
  name: string;
  artists: SpotifyArtistRef[];
  album: {
    name: string | null;
    images: SpotifyImage[];
  } | null;
  duration_ms: number;
  explicit: boolean;
}

export interface SpotifyArtistJson {
  id: string;
  genres: string[];
}

/**
 * Maps a Spotify track JSON object to the shared Track type.
 * `genresByArtistId` is an optional lookup (artist id -> genres) built from
 * a prior /v1/artists batch call; when omitted, genres is [].
 */
export function mapSpotifyTrack(
  track: SpotifyTrackJson,
  genresByArtistId?: Map<string, string[]>,
): Track {
  const primaryArtist = track.artists[0];
  const genres = primaryArtist ? (genresByArtistId?.get(primaryArtist.id) ?? []) : [];
  return {
    provider: 'spotify',
    providerTrackId: track.id,
    title: track.name,
    artist: track.artists.map((a) => a.name).join(', '),
    album: track.album?.name ?? null,
    durationMs: track.duration_ms,
    explicit: track.explicit,
    genres,
    artworkUrl: pickArtwork(track.album?.images ?? []),
  };
}

function pickArtwork(images: SpotifyImage[]): string | null {
  if (images.length === 0) return null;
  // Spotify returns images largest-first; take the largest as canonical
  // artwork (consumers can downscale via CSS/img sizing).
  return images[0]?.url ?? null;
}
