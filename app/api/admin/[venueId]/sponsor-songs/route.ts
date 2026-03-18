import { NextRequest, NextResponse } from 'next/server';
import { findVenueById, getSponsorSongsForVenue, upsertSponsorSong, deleteSponsorSong } from '@/lib/db/venues';
import { prisma } from '@/lib/db/prisma';

/**
 * Admin-only: Manage sponsor/anthem songs for a venue.
 * Protected by simple password check (POC only).
 *
 * Scaling Path: Replace with proper JWT/session-based admin auth.
 */
async function verifyAdmin(adminPassword: string, venueId: string): Promise<boolean> {
  const venue = await findVenueById(venueId);
  if (!venue) return false;
  return adminPassword === (venue as { adminPassword?: string }).adminPassword;
}

/** GET /api/admin/[venueId]/sponsor-songs?adminPassword=xxx — list sponsor songs */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ venueId: string }> },
) {
  try {
    const { venueId } = await params;
    const adminPassword = req.nextUrl.searchParams.get('adminPassword') ?? '';

    const isAdmin = await verifyAdmin(adminPassword, venueId);
    if (!isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sponsorSongs = await getSponsorSongsForVenue(venueId);
    return NextResponse.json({ sponsorSongs });
  } catch (error) {
    console.error('[GET /api/admin/[venueId]/sponsor-songs]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** POST /api/admin/[venueId]/sponsor-songs — add or update a sponsor/anthem song */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ venueId: string }> },
) {
  try {
    const { venueId } = await params;
    const body = await req.json().catch(() => ({}));
    const { adminPassword, songId, promotionText, promotionDurationMinutes, isAnthem } = body;

    const isAdmin = await verifyAdmin(adminPassword ?? '', venueId);
    if (!isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!songId || typeof songId !== 'string') {
      return NextResponse.json({ error: 'songId is required' }, { status: 400 });
    }

    // Verify the song exists
    const song = await prisma.song.findUnique({ where: { id: songId } });
    if (!song) {
      return NextResponse.json({ error: 'Song not found' }, { status: 404 });
    }

    const sponsorSong = await upsertSponsorSong(venueId, songId, {
      promotionText: promotionText ?? null,
      promotionDurationMinutes: promotionDurationMinutes ?? 5,
      isAnthem: isAnthem ?? false,
      isActive: true,
    });

    return NextResponse.json({ sponsorSong }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/admin/[venueId]/sponsor-songs]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** DELETE /api/admin/[venueId]/sponsor-songs — remove a sponsor/anthem song */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ venueId: string }> },
) {
  try {
    const { venueId } = await params;
    const body = await req.json().catch(() => ({}));
    const { adminPassword, songId } = body;

    const isAdmin = await verifyAdmin(adminPassword ?? '', venueId);
    if (!isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!songId || typeof songId !== 'string') {
      return NextResponse.json({ error: 'songId is required' }, { status: 400 });
    }

    await deleteSponsorSong(venueId, songId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/admin/[venueId]/sponsor-songs]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
