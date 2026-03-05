/**
 * API Route: Update Simulated User Count
 * PUT /api/sessions/[sessionId]/simulated-users
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';

interface RouteContext {
  params: Promise<{ sessionId: string }>;
}

export async function PUT(req: NextRequest, context: RouteContext) {
  try {
    const { sessionId } = await context.params;
    const body = await req.json();
    const { count } = body;

    if (typeof count !== 'number' || count < 0) {
      return NextResponse.json({ error: 'Invalid count' }, { status: 400 });
    }

    const session = await prisma.session.update({
      where: { id: sessionId },
      data: { simulatedUserCount: count },
    });

    return NextResponse.json({ simulatedUserCount: session.simulatedUserCount });
  } catch (err) {
    console.error('[PUT /api/sessions/[sessionId]/simulated-users]', err);
    return NextResponse.json({ error: 'Failed to update simulated users' }, { status: 500 });
  }
}
