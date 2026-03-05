import { NextRequest, NextResponse } from 'next/server';
import { searchSongs } from '@/lib/db/songs';
import { getStreamingServiceForVenue } from '@/lib/services/streaming';
import { StreamingTrack } from '@/lib/services/streaming/types';

// In-memory cache: key = "venueId:query", value = { tracks, timestamp }
const searchCache = new Map<string, { tracks: StreamingTrack[]; timestamp: number }>();
const CACHE_TTL_MS = 60_000; // 60 seconds

function getCached(key: string): StreamingTrack[] | null {
  const entry = searchCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    searchCache.delete(key);
    return null;
  }
  return entry.tracks;
}

export async function GET(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams.get('q') ?? '';
    const venueId = req.nextUrl.searchParams.get('venueId');

    if (!q || q.length < 2) {
      return NextResponse.json({ results: [] });
    }

    // Always run local DB search
    const localResults = await searchSongs(q);

    // If venue has a connected streaming service, also search there
    if (venueId) {
      const service = await getStreamingServiceForVenue(venueId);
      if (service) {
        const cacheKey = `${venueId}:${q.toLowerCase()}`;
        let streamingTracks = getCached(cacheKey);

        if (!streamingTracks) {
          try {
            const searchResult = await service.search(q);
            streamingTracks = searchResult.tracks;
            searchCache.set(cacheKey, { tracks: streamingTracks, timestamp: Date.now() });
          } catch (err) {
            console.error(`[Song search] Streaming search failed:`, err);
            streamingTracks = [];
          }
        }

        // Merge: streaming results first, then local results that aren't duplicates
        const seenIds = new Set<string>();
        const merged: Array<StreamingTrack | { id: string; title: string; artist: string; spotifyId?: string | null; youtubeId?: string | null; albumArtUrl?: string | null; durationMs?: number | null }> = [];

        for (const track of streamingTracks) {
          seenIds.add(track.serviceId);
          merged.push(track);
        }

        for (const song of localResults) {
          const serviceId = song.spotifyId ?? song.youtubeId;
          if (serviceId && seenIds.has(serviceId)) continue;
          merged.push(song);
        }

        return NextResponse.json({ results: merged });
      }
    }

    // Fallback: local DB search only
    return NextResponse.json({ results: localResults });
  } catch (error) {
    console.error('[GET /api/songs/search]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
