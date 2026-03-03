import { NextRequest, NextResponse } from 'next/server';
import { createRequest, checkDuplicateRequest } from '@/lib/db/requests';
import { findOrCreateSong } from '@/lib/db/songs';
import { findSessionById } from '@/lib/db/sessions';

/**
 * POST /api/requests
 * Submit a song request for the current session.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { sessionId, userId, title, artist, spotifyId, bpm, genreTags } = body;

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

    // Find or create the song in our catalog
    const song = await findOrCreateSong({
      spotifyId,
      title,
      artist,
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
    return NextResponse.json(request, { status: 201 });
  } catch (error) {
    console.error('[POST /api/requests]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
