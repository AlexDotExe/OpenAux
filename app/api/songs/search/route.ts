import { NextRequest, NextResponse } from 'next/server';
import { searchSongs } from '@/lib/db/songs';

export async function GET(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams.get('q') ?? '';
    if (!q || q.length < 2) {
      return NextResponse.json({ results: [] });
    }
    const results = await searchSongs(q);
    return NextResponse.json({ results });
  } catch (error) {
    console.error('[GET /api/songs/search]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
