import { NextRequest, NextResponse } from 'next/server';
import { findVenueById } from '@/lib/db/venues';
import { getSponsorSongs, createSponsorSong } from '@/lib/db/sponsorSongs';
import { prisma } from '@/lib/db/prisma';

async function verifyAdmin(venueId: string, adminPassword: string): Promise<boolean> {
  const venue = await findVenueById(venueId);
  if (!venue) return false;
  return adminPassword === (venue as { adminPassword?: string }).adminPassword;
}

/**
 * GET /api/admin/[venueId]/sponsor-songs
 * List all sponsor songs for the venue.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ venueId: string }> },
) {
  try {
    const { venueId } = await params;
    const adminPassword = req.headers.get('x-admin-password') ?? req.nextUrl.searchParams.get('adminPassword') ?? '';

    if (!await verifyAdmin(venueId, adminPassword)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sponsorSongs = await getSponsorSongs(venueId);
    return NextResponse.json({ sponsorSongs });
  } catch (error) {
    console.error('[GET /api/admin/:venueId/sponsor-songs]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/admin/[venueId]/sponsor-songs
 * Create a new sponsor song for the venue.
 * Body: { adminPassword, songId, promotionText?, promotionDurationMinutes?, isAnthem? }
 * If the song doesn't exist in the DB yet, provide title + artist to upsert it.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ venueId: string }> },
) {
  try {
    const { venueId } = await params;
    const body = await req.json();
    const {
      adminPassword,
      songId,
      title,
      artist,
      albumArtUrl,
      spotifyId,
      youtubeId,
      promotionText,
      promotionDurationMinutes,
      isAnthem,
    } = body;

    if (!await verifyAdmin(venueId, adminPassword)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!title || !artist) {
      return NextResponse.json({ error: 'title and artist are required' }, { status: 400 });
    }

    // Upsert the song record so we have a stable DB ID
    let song;
    if (spotifyId) {
      song = await prisma.song.upsert({
        where: { spotifyId },
        update: { title, artist, albumArtUrl: albumArtUrl ?? null },
        create: { title, artist, albumArtUrl: albumArtUrl ?? null, spotifyId },
      });
    } else if (youtubeId) {
      song = await prisma.song.upsert({
        where: { youtubeId },
        update: { title, artist, albumArtUrl: albumArtUrl ?? null },
        create: { title, artist, albumArtUrl: albumArtUrl ?? null, youtubeId },
      });
    } else if (songId) {
      // Song already exists in DB by its internal ID
      song = await prisma.song.findUnique({ where: { id: songId } });
      if (!song) {
        return NextResponse.json({ error: 'Song not found' }, { status: 404 });
      }
    } else {
      return NextResponse.json({ error: 'songId, spotifyId, or youtubeId is required' }, { status: 400 });
    }

    const sponsorSong = await createSponsorSong({
      venueId,
      songId: song.id,
      promotionText: promotionText ?? null,
      promotionDurationMinutes: promotionDurationMinutes ?? 5,
      isAnthem: isAnthem ?? false,
    });

    return NextResponse.json({ sponsorSong }, { status: 201 });
  } catch (error: unknown) {
    if ((error as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: 'This song is already a sponsor song for this venue' }, { status: 409 });
    }
    console.error('[POST /api/admin/:venueId/sponsor-songs]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
