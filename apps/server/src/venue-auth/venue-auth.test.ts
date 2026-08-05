import { describe, expect, it } from 'vitest';
import { hashPassword, hashToken, verifyPassword } from './crypto.js';
import { VenueAuthError, VenueAuthService } from './service.js';
import { createVenueAdminVerifier } from './verifier.js';
import { InMemoryVenueAuthRepository } from './test-support/memory-repository.js';

function service() {
  const repository = new InMemoryVenueAuthRepository();
  return { repository, svc: new VenueAuthService({ repository }) };
}

describe('crypto', () => {
  it('verifies a correct password and rejects a wrong one', () => {
    const stored = hashPassword('correct horse battery');
    expect(verifyPassword('correct horse battery', stored)).toBe(true);
    expect(verifyPassword('wrong', stored)).toBe(false);
  });

  it('produces distinct hashes for the same password (random salt)', () => {
    expect(hashPassword('same')).not.toBe(hashPassword('same'));
  });
});

describe('signup', () => {
  it('creates an owner and issues a session token', async () => {
    const { svc } = service();
    const res = await svc.signup('Owner@Bar.com', 'password123', 'The Owner');
    expect(res.token).toBeTruthy();
    expect(res.owner.email).toBe('owner@bar.com'); // normalized
    expect(res.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects short passwords and bad emails', async () => {
    const { svc } = service();
    await expect(svc.signup('a@b.co', 'short', 'X')).rejects.toBeInstanceOf(VenueAuthError);
    await expect(svc.signup('notanemail', 'password123', 'X')).rejects.toBeInstanceOf(
      VenueAuthError,
    );
  });

  it('rejects a duplicate email', async () => {
    const { svc } = service();
    await svc.signup('dup@bar.com', 'password123', 'One');
    await expect(svc.signup('dup@bar.com', 'password123', 'Two')).rejects.toMatchObject({
      code: 'validation',
    });
  });
});

describe('login', () => {
  it('accepts correct credentials, rejects wrong password and unknown email', async () => {
    const { svc } = service();
    await svc.signup('dj@bar.com', 'password123', 'DJ');
    const ok = await svc.login('DJ@bar.com', 'password123');
    expect(ok.token).toBeTruthy();
    await expect(svc.login('dj@bar.com', 'nope')).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(svc.login('ghost@bar.com', 'password123')).rejects.toMatchObject({
      code: 'unauthorized',
    });
  });
});

describe('createVenue', () => {
  it('creates a venue owned by the caller with a QR token', async () => {
    const { svc, repository } = service();
    const { owner } = await svc.signup('v@bar.com', 'password123', 'V');
    const venue = await svc.createVenue(owner.venueOwnerId, {
      name: 'Neon',
      musicProvider: 'spotify',
    });
    expect(venue.name).toBe('Neon');
    expect(venue.qrToken).toBeTruthy();
    expect(await repository.ownerOwnsVenue(owner.venueOwnerId, venue.venueId)).toBe(true);
  });

  it('rejects a blank name or bad provider', async () => {
    const { svc } = service();
    const { owner } = await svc.signup('v2@bar.com', 'password123', 'V');
    await expect(
      svc.createVenue(owner.venueOwnerId, { name: '  ', musicProvider: 'spotify' }),
    ).rejects.toMatchObject({ code: 'validation' });
    await expect(
      svc.createVenue(owner.venueOwnerId, {
        name: 'X',
        musicProvider: 'tidal' as 'spotify',
      }),
    ).rejects.toMatchObject({ code: 'validation' });
  });
});

describe('verifier', () => {
  it('authorizes the owning venue and rejects a non-owner venue', async () => {
    const repository = new InMemoryVenueAuthRepository();
    const svc = new VenueAuthService({ repository });
    const verifier = createVenueAdminVerifier({ repository, legacySecret: () => null });

    const a = await svc.signup('a@bar.com', 'password123', 'A');
    const b = await svc.signup('b@bar.com', 'password123', 'B');
    const venueA = await svc.createVenue(a.owner.venueOwnerId, {
      name: 'A',
      musicProvider: 'spotify',
    });

    expect(await verifier.verifyOwner(a.token)).toBe(a.owner.venueOwnerId);
    expect(await verifier.verifyVenueAdmin(venueA.venueId, a.token)).toBe(true);
    expect(await verifier.verifyVenueAdmin(venueA.venueId, b.token)).toBe(false);
    expect(await verifier.verifyVenueAdmin(venueA.venueId, null)).toBe(false);
  });

  it('rejects an expired session', async () => {
    const repository = new InMemoryVenueAuthRepository();
    const past = new Date(Date.now() - 1000);
    await repository.createSession(hashToken('tok'), 'owner-1', past);
    const verifier = createVenueAdminVerifier({ repository, legacySecret: () => null });
    expect(await verifier.verifyOwner('tok')).toBeNull();
  });

  it('accepts the legacy shared secret as a fallback', async () => {
    const repository = new InMemoryVenueAuthRepository();
    const verifier = createVenueAdminVerifier({ repository, legacySecret: () => 'legacy-secret' });
    expect(await verifier.verifyVenueAdmin('any-venue', 'legacy-secret')).toBe(true);
    expect(await verifier.verifyVenueAdmin('any-venue', 'wrong')).toBe(false);
  });
});
