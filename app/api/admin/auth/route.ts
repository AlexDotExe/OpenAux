import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    { error: 'Admin sign-in now uses Spotify or Google OAuth.' },
    { status: 410 },
  );
}
