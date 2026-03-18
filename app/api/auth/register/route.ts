import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { findUserByEmail, createAuthUser } from '@/lib/db/users';

const BCRYPT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 8;

export async function POST(req: NextRequest) {
  try {
    const { email, password, displayName } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Basic email format validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` },
        { status: 400 },
      );
    }

    const existing = await findUserByEmail(normalizedEmail);
    if (existing) {
      return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const authToken = uuidv4();

    const user = await createAuthUser({
      email: normalizedEmail,
      passwordHash,
      displayName: displayName?.trim() || undefined,
      authProvider: 'email',
      authToken,
    });

    return NextResponse.json({
      userId: user.id,
      authToken,
      email: user.email,
      displayName: user.displayName,
      reputationScore: user.reputationScore,
      influenceWeight: user.influenceWeight,
      creditBalance: user.creditBalance,
      authProvider: user.authProvider,
    });
  } catch (error) {
    console.error('[POST /api/auth/register]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
