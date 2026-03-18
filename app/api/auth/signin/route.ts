import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { findUserByEmail, updateUserAuthToken } from '@/lib/db/users';

// Pre-hashed dummy password for constant-time comparison when user is not found
// This prevents timing attacks that could enumerate registered email addresses
const DUMMY_HASH = '$2a$12$dummy.hash.for.timing.protection.only.do.not.use';

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const user = await findUserByEmail(normalizedEmail);
    if (!user || !user.passwordHash) {
      // Always run bcrypt to prevent timing-based user enumeration
      await bcrypt.compare(password, DUMMY_HASH);
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    const passwordMatch = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatch) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    // Rotate auth token on each sign-in
    const authToken = uuidv4();
    await updateUserAuthToken(user.id, authToken);

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
    console.error('[POST /api/auth/signin]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
