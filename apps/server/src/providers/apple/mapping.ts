/**
 * Maps raw Apple Music Catalog API JSON shapes to the shared Track type.
 */
import type { Track } from '@openaux/shared';

export interface AppleArtwork {
  url: string;
  width: number;
  height: number;
}

export interface AppleSongAttributes {
  name: string;
  artistName: string;
  albumName: string | null;
  durationInMillis: number;
  /** 'explicit' | 'clean' | 'notExplicit' (Apple's contentRating field is optional/loose). */
  contentRating?: string;
  genreNames: string[];
  artwork?: AppleArtwork;
}

export interface AppleSongJson {
  id: string;
  attributes: AppleSongAttributes;
}

const DEFAULT_ARTWORK_SIZE = 300;

export function mapAppleSong(song: AppleSongJson): Track {
  const attrs = song.attributes;
  return {
    provider: 'apple_music',
    providerTrackId: song.id,
    title: attrs.name,
    artist: attrs.artistName,
    album: attrs.albumName ?? null,
    durationMs: attrs.durationInMillis,
    explicit: attrs.contentRating === 'explicit',
    genres: attrs.genreNames ?? [],
    artworkUrl: attrs.artwork ? resolveArtworkUrl(attrs.artwork) : null,
  };
}

/** Apple artwork URLs contain {w}/{h} template placeholders to fill in. */
function resolveArtworkUrl(artwork: AppleArtwork): string {
  return artwork.url
    .replace('{w}', String(DEFAULT_ARTWORK_SIZE))
    .replace('{h}', String(DEFAULT_ARTWORK_SIZE));
}
