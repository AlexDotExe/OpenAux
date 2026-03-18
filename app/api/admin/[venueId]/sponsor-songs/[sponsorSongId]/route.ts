import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminToken } from '@/lib/db/venues';
import { updateSponsorSong, deleteSponsorSong } from '@/lib/db/sponsorSongs';

/**
 * PUT /api/admin/[venueId]/sponsor-songs/[sponsorSongId]
 * Update a sponsor song's promotion details.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ venueId: string; sponsorSongId: string }> },
) {
  try {
    const { venueId, sponsorSongId } = await params;
    const body = await req.json();
    const { adminPassword, promotionText, promotionDurationMinutes, isActive, isAnthem } = body;

    if (!await verifyAdminToken(venueId, adminPassword)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const updated = await updateSponsorSong(sponsorSongId, {
      promotionText: promotionText ?? undefined,
      promotionDurationMinutes: promotionDurationMinutes ?? undefined,
      isActive: isActive ?? undefined,
      isAnthem: isAnthem ?? undefined,
    });

    return NextResponse.json({ sponsorSong: updated });
  } catch (error) {
    console.error('[PUT /api/admin/:venueId/sponsor-songs/:sponsorSongId]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/[venueId]/sponsor-songs/[sponsorSongId]
 * Remove a sponsor song.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ venueId: string; sponsorSongId: string }> },
) {
  try {
    const { venueId, sponsorSongId } = await params;
    const body = await req.json().catch(() => ({}));
    const adminPassword = body.adminPassword ?? req.nextUrl.searchParams.get('adminPassword') ?? '';

    if (!await verifyAdminToken(venueId, adminPassword)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await deleteSponsorSong(sponsorSongId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/admin/:venueId/sponsor-songs/:sponsorSongId]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
