import { NextRequest, NextResponse } from 'next/server';
import { createRequest, checkDuplicateRequest, countUserRequestsInSession, findActiveRequests } from '@/lib/db/requests';
import { findOrCreateSong } from '@/lib/db/songs';
import { findSessionById } from '@/lib/db/sessions';
import { findVenueById } from '@/lib/db/venues';
import { calculateSmartSettings } from '@/lib/services/smartMonetization';
import { invalidateQueueCache } from '@/lib/services/queueCache';
import { updateUserSessionActivity } from '@/lib/db/userSessions';
import { findUserSession, updateUserSessionLastRequest } from '@/lib/db/users';
import { resolveYouTubeId } from '@/lib/services/streaming/youtubeResolver';

const COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes

/**
 * POST /api/requests
 * Submit a song request for the current session.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { sessionId, userId, title, artist, spotifyId, youtubeId, albumArtUrl, durationMs, bpm, genreTags } = body;

    if (!sessionId || !userId || !title || !artist) {
      return NextResponse.json(
        { error: 'sessionId, userId, title, and artist are required' },
        { status: 400 },
      );
    }

    const session = await findSessionById(sessionId);
    if (!session || !session.isActive) {
      return NextResponse.json({ error: 'Session not found or not active' }, { status: 404 });
    }

    // Enforce per-user cooldown: 1 request per 2 minutes
    const userSession = await findUserSession(userId, sessionId);
    if (userSession?.lastRequestAt) {
      const elapsed = Date.now() - userSession.lastRequestAt.getTime();
      if (elapsed < COOLDOWN_MS) {
        const cooldownRemainingSeconds = Math.ceil((COOLDOWN_MS - elapsed) / 1000);
        return NextResponse.json(
          { error: `Please wait ${cooldownRemainingSeconds}s before requesting another song`, cooldownRemainingSeconds },
          { status: 429 },
        );
      }
    }

    // Check user's pending request limit using effective settings
    const venue = await findVenueById(session.venueId);
    if (venue) {
      let maxSongsPerUser: number;

      if (venue.smartMonetizationEnabled) {
        // Calculate smart settings based on user count + simulated users
        const requests = await findActiveRequests(sessionId);
        const uniqueUsers = new Set(requests.map(r => r.userId));
        const realUserCount = uniqueUsers.size;
        const totalUserCount = realUserCount + session.simulatedUserCount;

        const smartSettings = calculateSmartSettings(totalUserCount);
        maxSongsPerUser = smartSettings.maxSongsPerUser;
      } else {
        // Use manual settings from venue
        maxSongsPerUser = venue.maxSongsPerUser;
      }

      if (maxSongsPerUser > 0) {
        const userRequestCount = await countUserRequestsInSession(userId, sessionId);
        if (userRequestCount >= maxSongsPerUser) {
          return NextResponse.json(
            { error: `You have reached the maximum of ${maxSongsPerUser} pending songs` },
            { status: 429 },
          );
        }
      }
    }

    // Resolve YouTube video ID if not already provided
    let resolvedYoutubeId = youtubeId;
    if (!resolvedYoutubeId && venue?.streamingService === 'youtube') {
      try {
        resolvedYoutubeId = await resolveYouTubeId(`${title} ${artist}`);
      } catch (err) {
        console.error('[POST /api/requests] YouTube ID resolution failed:', err);
        // Continue without YouTube ID — song still gets queued
      }
    }

    // Find or create the song in our catalog
    const song = await findOrCreateSong({
      spotifyId,
      youtubeId: resolvedYoutubeId,
      title,
      artist,
      albumArtUrl,
      durationMs,
      bpm,
      genreTags: genreTags ?? [],
    });

    // Prevent duplicate requests in the same session
    const duplicate = await checkDuplicateRequest(sessionId, song.id);
    if (duplicate) {
      return NextResponse.json(
        { error: 'This song has already been requested in this session', existingRequestId: duplicate.id },
        { status: 409 },
      );
    }

    const request = await createRequest({ sessionId, songId: song.id, userId });

    // Reset the session expiry timer for this user
    await updateUserSessionActivity(userId, sessionId);

    // Record timestamp for cooldown enforcement
    await updateUserSessionLastRequest(userId, sessionId);

    // Invalidate queue cache and return updated queue so UI updates immediately
    invalidateQueueCache(sessionId);

    const { getRankedQueue } = await import('@/lib/services/virtualDjEngine');
    const queue = await getRankedQueue(sessionId, true); // skipCache = true

    return NextResponse.json({ request, queue }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/requests]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
