import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    { error: 'Admin sign-up now starts with Spotify or Google OAuth.' },
    { status: 410 },
  );
}
