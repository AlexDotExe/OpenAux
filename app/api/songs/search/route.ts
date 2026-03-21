import { NextRequest, NextResponse } from 'next/server';
import { searchSongs } from '@/lib/db/songs';

interface ITunesResult {
  trackId: number;
  trackName: string;
  artistName: string;
  artworkUrl100?: string;
  trackTimeMillis?: number;
}

// In-memory cache: key = query, value = { results, timestamp }
const searchCache = new Map<string, { results: ITunesResult[]; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60_000; // 5 minutes

function getCached(key: string): ITunesResult[] | null {
  const entry = searchCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    searchCache.delete(key);
    return null;
  }
  return entry.results;
}

export async function GET(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams.get('q') ?? '';

    if (!q || q.length < 2) {
      return NextResponse.json({ results: [] });
    }

    // Local DB search (songs previously requested)
    const localResults = await searchSongs(q);

    // iTunes Search API — free, no auth, no quota
    const cacheKey = q.toLowerCase().trim();
    let itunesTracks: ITunesResult[] = getCached(cacheKey) ?? [];

    if (itunesTracks.length === 0) {
      try {
        const params = new URLSearchParams({
          term: q,
          media: 'music',
          entity: 'song',
          limit: '20',
        });
        const res = await fetch(`https://itunes.apple.com/search?${params}`);
        if (res.ok) {
          const data = await res.json();
          itunesTracks = data.results ?? [];
          searchCache.set(cacheKey, { results: itunesTracks, timestamp: Date.now() });
        } else {
          itunesTracks = [];
        }
      } catch (err) {
        console.error('[Song search] iTunes search failed:', err);
        itunesTracks = [];
      }
    }

    // Map iTunes results to our format
    const itunesMapped = itunesTracks.map((t) => ({
      // No serviceId yet — YouTube ID resolved on submit
      title: t.trackName,
      artist: t.artistName,
      albumArtUrl: t.artworkUrl100?.replace('100x100', '300x300') ?? null,
      durationMs: t.trackTimeMillis ?? null,
      source: 'itunes' as const,
    }));

    // Merge: iTunes results first, then local DB results that aren't duplicates
    const seen = new Set<string>();
    const merged: Array<typeof itunesMapped[number] | { id: string; title: string; artist: string; spotifyId?: string | null; youtubeId?: string | null; albumArtUrl?: string | null; durationMs?: number | null }> = [];

    for (const track of itunesMapped) {
      const key = `${track.title.toLowerCase()}::${track.artist.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(track);
      }
    }

    for (const song of localResults) {
      const key = `${song.title.toLowerCase()}::${song.artist.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(song);
      }
    }

    return NextResponse.json({ results: merged });
  } catch (error) {
    console.error('[GET /api/songs/search]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
