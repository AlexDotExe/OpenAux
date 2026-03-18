import { NextRequest, NextResponse } from 'next/server';
import { findSessionById } from '@/lib/db/sessions';
import { getRankedQueue } from '@/lib/services/virtualDjEngine';
import { findVenueById, getSponsorSongsForVenue } from '@/lib/db/venues';
import { getUserSession } from '@/lib/db/userSessions';
import { findPendingSuggestions } from '@/lib/db/requests';
import { getActivePromotion } from '@/lib/db/sponsorSongs';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = await params;
    const session = await findSessionById(sessionId);
    if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

    const userId = req.nextUrl.searchParams.get('userId');

    // getRankedQueue internally fetches venue, so we can fetch both in parallel
    // but we still need venue name for response
    const [queue, venue, userSession, activePromotion, sponsorSongs] = await Promise.all([
      getRankedQueue(sessionId),
      findVenueById(session.venueId),
      userId ? getUserSession(userId, sessionId) : Promise.resolve(null),
      getActivePromotion(session.venueId),
      getSponsorSongsForVenue(session.venueId),
    ]);

    const suggestionModeEnabled = venue?.suggestionModeEnabled ?? false;
    const crowdControlEnabled = venue?.crowdControlEnabled ?? true;

    // When suggestion mode is enabled, include pending suggestions so users can track their own
    const pendingSuggestions = suggestionModeEnabled
      ? await findPendingSuggestions(sessionId)
      : [];

    // Note: Removed playback history from polling endpoint
    // It's rarely used and expensive to fetch. Can add a separate endpoint if needed.

    // Check if the next song in the queue is a sponsor/anthem song
    const sponsorSongMap = new Map(sponsorSongs.map((ss) => [ss.songId, ss]));
    let anthemAnnouncement: {
      type: 'upcoming';
      title: string;
      artist: string;
      promotionText: string | null;
      isAnthem: boolean;
    } | null = null;
    if (queue.length > 0) {
      const nextSong = queue[0];
      const sponsorInfo = sponsorSongMap.get(nextSong.songId);
      if (sponsorInfo) {
        anthemAnnouncement = {
          type: 'upcoming',
          title: nextSong.title,
          artist: nextSong.artist,
          promotionText: sponsorInfo.promotionText,
          isAnthem: sponsorInfo.isAnthem,
        };
      }
    }

    return NextResponse.json({
      session,
      queue,
      venueName: venue?.name || 'Unknown Venue',
      userSession: userSession
        ? { expiresAt: userSession.expiresAt.toISOString(), isExpired: userSession.isExpired }
        : null,
      suggestionModeEnabled,
      crowdControlEnabled,
      pendingSuggestions: pendingSuggestions.map(s => ({
        requestId: s.id,
        title: s.song.title,
        artist: s.song.artist,
        userId: s.userId,
        createdAt: s.createdAt,
      })),
      anthemAnnouncement,
      activePromotion: activePromotion
        ? {
            id: activePromotion.id,
            promotionText: activePromotion.promotionText,
            promotionDurationMinutes: activePromotion.promotionDurationMinutes,
            promotionActivatedAt: activePromotion.promotionActivatedAt,
            promotionExpiresAt: activePromotion.promotionExpiresAt,
            isAnthem: activePromotion.isAnthem,
            song: activePromotion.song,
          }
        : null,
    });
  } catch (error) {
    console.error('[GET /api/sessions/:sessionId]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
