/**
 * API Routes: Admin Suggestions Management
 *
 * GET  /api/admin/[venueId]/suggestions - List pending suggestions for the active session
 * POST /api/admin/[venueId]/suggestions - Bulk approve or reject pending suggestions
 */

import { NextRequest, NextResponse } from 'next/server';
import { findVenueById } from '@/lib/db/venues';
import { findSessionById } from '@/lib/db/sessions';
import { findPendingSuggestions, updateRequestStatus } from '@/lib/db/requests';
import { invalidateQueueCache } from '@/lib/services/queueCache';
import { prisma } from '@/lib/db/prisma';

interface RouteContext {
  params: Promise<{ venueId: string }>;
}

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const { venueId } = await context.params;
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get('sessionId');

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId query param is required' }, { status: 400 });
    }

    const venue = await findVenueById(venueId);
    if (!venue) {
      return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    }

    const suggestions = await findPendingSuggestions(sessionId);

    return NextResponse.json({
      suggestions: suggestions.map(s => ({
        requestId: s.id,
        title: s.song.title,
        artist: s.song.artist,
        albumArtUrl: s.song.albumArtUrl,
        userId: s.userId,
        displayName: s.user.displayName,
        createdAt: s.createdAt,
      })),
    });
  } catch (error) {
    console.error('[GET /api/admin/[venueId]/suggestions]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { venueId } = await context.params;
    const body = await req.json();
    const { adminPassword, action, requestIds, sessionId } = body;

    if (!adminPassword) {
      return NextResponse.json({ error: 'adminPassword is required' }, { status: 400 });
    }

    if (!action || !['approve', 'reject'].includes(action)) {
      return NextResponse.json({ error: 'action must be "approve" or "reject"' }, { status: 400 });
    }

    if (!Array.isArray(requestIds) || requestIds.length === 0) {
      return NextResponse.json({ error: 'requestIds must be a non-empty array' }, { status: 400 });
    }

    const venue = await findVenueById(venueId);
    if (!venue) {
      return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    }

    if (adminPassword !== venue.adminPassword) {
      return NextResponse.json({ error: 'Invalid admin password' }, { status: 401 });
    }

    const newStatus = action === 'approve' ? 'APPROVED' : 'DELETED';
    const actionType = action === 'approve' ? 'APPROVE_SUGGESTION' : 'REJECT_SUGGESTION';

    // Fetch matching PENDING requests to validate they exist and belong to this venue's session
    const requests = await prisma.songRequest.findMany({
      where: {
        id: { in: requestIds },
        status: 'PENDING',
        session: { venueId },
      },
      select: { id: true, sessionId: true },
    });

    if (requests.length === 0) {
      return NextResponse.json({ error: 'No matching pending requests found' }, { status: 404 });
    }

    // Bulk update status
    await prisma.songRequest.updateMany({
      where: { id: { in: requests.map(r => r.id) } },
      data: { status: newStatus },
    });

    // Log admin actions
    const resolvedSessionId = sessionId ?? requests[0].sessionId;
    await prisma.adminAction.createMany({
      data: requests.map(r => ({
        venueId,
        sessionId: r.sessionId,
        actionType,
        targetRequestId: r.id,
      })),
    });

    // Invalidate queue cache for affected sessions
    const sessionIds = [...new Set(requests.map(r => r.sessionId))];
    sessionIds.forEach(sid => invalidateQueueCache(sid));

    return NextResponse.json({
      updated: requests.length,
      action,
    });
  } catch (error) {
    console.error('[POST /api/admin/[venueId]/suggestions]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
