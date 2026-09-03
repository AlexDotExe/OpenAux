import { describe, expect, it } from 'vitest';
import type { QueueItemStatus } from '@openaux/shared';
import { PaymentsService } from './service.js';
import { InMemoryPaymentsRepo } from './memory-repo.js';
import { FakeGateway } from './gateway.js';
import { RecordingAnalyticsSink } from './analytics.js';
import { isPaymentsError } from './errors.js';

function setup(gateway = new FakeGateway()) {
  const repo = new InMemoryPaymentsRepo();
  const analytics = new RecordingAnalyticsSink();
  const service = new PaymentsService({ repo, gateway, analytics });
  return { repo, analytics, gateway, service };
}

/** Sum of a user's ledger deltas must equal the denormalized credit_balance. */
function assertLedgerMatchesBalance(repo: InMemoryPaymentsRepo, userId: string) {
  const fromLedger = repo.ledger
    .filter((e) => e.userId === userId)
    .reduce((sum, e) => sum + e.delta, 0);
  expect(repo.users.get(userId)!.creditBalance).toBe(fromLedger);
}

describe('purchaseCredits', () => {
  it('charges the card, credits the ledger, and updates the cache balance', async () => {
    const { repo, service, gateway } = setup();
    repo.seedUser({ userId: 'u1', authProvider: 'google', creditBalance: 0 });

    const res = await service.purchaseCredits({
      userId: 'u1',
      venueId: 'v1',
      bundleId: 'starter_5',
      paymentMethodToken: 'pm_1',
      idempotencyKey: 'buy-1',
    });

    expect(res.creditBalance).toBe(5);
    expect(gateway.calls).toHaveLength(1);
    expect(repo.paymentEvents).toHaveLength(1);
    expect(repo.paymentEvents[0]).toMatchObject({
      paymentType: 'credit_purchase',
      status: 'completed',
      creditAmount: 5,
      cashAmountCents: 499,
    });
    assertLedgerMatchesBalance(repo, 'u1');
  });

  it('is idempotent on double-submit: same key never double-credits or double-charges', async () => {
    const { repo, service, gateway } = setup();
    repo.seedUser({ userId: 'u1', creditBalance: 0 });

    const first = await service.purchaseCredits({
      userId: 'u1',
      venueId: 'v1',
      bundleId: 'starter_5',
      paymentMethodToken: 'pm_1',
      idempotencyKey: 'dup',
    });
    const second = await service.purchaseCredits({
      userId: 'u1',
      venueId: 'v1',
      bundleId: 'starter_5',
      paymentMethodToken: 'pm_1',
      idempotencyKey: 'dup',
    });

    expect(first.creditBalance).toBe(5);
    expect(second.creditBalance).toBe(5);
    expect(gateway.calls).toHaveLength(1);
    expect(repo.paymentEvents).toHaveLength(1);
    assertLedgerMatchesBalance(repo, 'u1');
  });

  it('rejects an unknown bundle', async () => {
    const { repo, service } = setup();
    repo.seedUser({ userId: 'u1' });
    await expect(
      service.purchaseCredits({
        userId: 'u1',
        venueId: 'v1',
        bundleId: 'ghost',
        paymentMethodToken: 'pm_1',
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  describe('guest restriction (SPEC.md §4)', () => {
    it('lets a guest buy the smallest bundle', async () => {
      const { repo, service } = setup();
      repo.seedUser({ userId: 'g1', authProvider: 'guest', creditBalance: 0 });
      const res = await service.purchaseCredits({
        userId: 'g1',
        venueId: 'v1',
        bundleId: 'starter_5',
        paymentMethodToken: 'pm_1',
        idempotencyKey: 'g-buy',
      });
      expect(res.creditBalance).toBe(5);
    });

    it('blocks a guest from buying a larger bundle', async () => {
      const { repo, service, gateway } = setup();
      repo.seedUser({ userId: 'g1', authProvider: 'guest', creditBalance: 0 });
      await expect(
        service.purchaseCredits({
          userId: 'g1',
          venueId: 'v1',
          bundleId: 'value_12',
          paymentMethodToken: 'pm_1',
          idempotencyKey: 'g-buy-2',
        }),
      ).rejects.toMatchObject({ code: 'unauthorized' });
      // Never charged.
      expect(gateway.calls).toHaveLength(0);
    });
  });

  it('records a failed payment_event and refuses credit when the charge fails', async () => {
    const { repo, service } = setup(new FakeGateway({ status: 'failed' }));
    repo.seedUser({ userId: 'u1', creditBalance: 0 });

    await expect(
      service.purchaseCredits({
        userId: 'u1',
        venueId: 'v1',
        bundleId: 'starter_5',
        paymentMethodToken: 'pm_bad',
        idempotencyKey: 'fail-1',
      }),
    ).rejects.toMatchObject({ code: 'payment_gateway_error' });

    expect(repo.users.get('u1')!.creditBalance).toBe(0);
    expect(repo.paymentEvents.some((e) => e.status === 'failed')).toBe(true);
    expect(repo.ledger).toHaveLength(0);
  });
});

describe('purchaseBoost', () => {
  function seedBoostable() {
    const ctx = setup();
    ctx.repo.seedUser({ userId: 'u1', creditBalance: 3 });
    ctx.repo.seedQueueItem({ queueItemId: 'q1', venueId: 'v1' });
    return ctx;
  }

  it('debits 1 credit, increments boost count, and emits boost_purchased', async () => {
    const { repo, analytics, service } = seedBoostable();
    const res = await service.purchaseBoost({
      userId: 'u1',
      queueItemId: 'q1',
      boostType: 'priority_boost',
      idempotencyKey: 'boost-1',
    });

    expect(res.creditBalance).toBe(2);
    expect(res.priorityBoostCount).toBe(1);
    expect(repo.queueItems.get('q1')!.priorityBoostCount).toBe(1);
    expect(repo.ledger.some((e) => e.reason === 'priority_boost' && e.delta === -1)).toBe(true);
    expect(analytics.events.map((e) => e.eventType)).toContain('boost_purchased');
    assertLedgerMatchesBalance(repo, 'u1');
  });

  it('is idempotent on double-submit (same key): debits once, one analytics event', async () => {
    const { repo, analytics, service } = seedBoostable();
    await service.purchaseBoost({
      userId: 'u1',
      queueItemId: 'q1',
      boostType: 'priority_boost',
      idempotencyKey: 'same',
    });
    const second = await service.purchaseBoost({
      userId: 'u1',
      queueItemId: 'q1',
      boostType: 'priority_boost',
      idempotencyKey: 'same',
    });

    expect(second.creditBalance).toBe(2);
    expect(repo.queueItems.get('q1')!.priorityBoostCount).toBe(1);
    expect(analytics.events.filter((e) => e.eventType === 'boost_purchased')).toHaveLength(1);
    assertLedgerMatchesBalance(repo, 'u1');
  });

  it('enforces the 1-boost-per-song-per-user limit (boost_limit_reached)', async () => {
    const { repo, service } = seedBoostable();
    await service.purchaseBoost({
      userId: 'u1',
      queueItemId: 'q1',
      boostType: 'priority_boost',
      idempotencyKey: 'first',
    });
    await expect(
      service.purchaseBoost({
        userId: 'u1',
        queueItemId: 'q1',
        boostType: 'priority_boost',
        idempotencyKey: 'second-different-key',
      }),
    ).rejects.toMatchObject({ code: 'boost_limit_reached' });

    // Only the first boost stuck.
    expect(repo.users.get('u1')!.creditBalance).toBe(2);
    expect(repo.queueItems.get('q1')!.priorityBoostCount).toBe(1);
    assertLedgerMatchesBalance(repo, 'u1');
  });

  it('rejects a boost when the user has no credits', async () => {
    const { repo, service } = setup();
    repo.seedUser({ userId: 'u1', creditBalance: 0 });
    repo.seedQueueItem({ queueItemId: 'q1', venueId: 'v1' });
    await expect(
      service.purchaseBoost({
        userId: 'u1',
        queueItemId: 'q1',
        boostType: 'priority_boost',
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ code: 'insufficient_credits' });
  });

  it('rejects an unknown queue item', async () => {
    const { repo, service } = setup();
    repo.seedUser({ userId: 'u1', creditBalance: 3 });
    await expect(
      service.purchaseBoost({
        userId: 'u1',
        queueItemId: 'missing',
        boostType: 'priority_boost',
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('rejects super_boost as not-yet-available (V2) without charging', async () => {
    const { repo, service, analytics } = seedBoostable();
    await expect(
      service.purchaseBoost({
        userId: 'u1',
        queueItemId: 'q1',
        boostType: 'super_boost',
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ code: 'boost_type_unavailable' });
    expect(repo.users.get('u1')!.creditBalance).toBe(3);
    expect(repo.paymentEvents).toHaveLength(0);
    expect(analytics.events).toHaveLength(0);
  });
});

describe('purchaseBoost — Instant Play Vote ($3, V1)', () => {
  function seedVoter(creditBalance = 3) {
    const ctx = setup();
    ctx.repo.seedUser({ userId: 'u1', creditBalance });
    ctx.repo.seedQueueItem({ queueItemId: 'q1', venueId: 'v1' });
    return ctx;
  }

  it('debits 3 credits, increments instantVoteCount, writes the event, emits boost_purchased', async () => {
    const { repo, analytics, service } = seedVoter();
    const res = await service.purchaseBoost({
      userId: 'u1',
      queueItemId: 'q1',
      boostType: 'instant_play_vote',
      idempotencyKey: 'ipv-1',
    });

    expect(res.creditBalance).toBe(0);
    expect(repo.queueItems.get('q1')!.instantVoteCount).toBe(1);
    expect(repo.queueItems.get('q1')!.priorityBoostCount).toBe(0);
    const event = repo.paymentEvents.find((e) => e.paymentType === 'instant_play_vote');
    expect(event).toMatchObject({ status: 'completed', creditAmount: 3, cashAmountCents: 0 });
    expect(repo.ledger.some((e) => e.reason === 'instant_play_vote' && e.delta === -3)).toBe(true);
    const purchased = analytics.events.filter((e) => e.eventType === 'boost_purchased');
    expect(purchased).toHaveLength(1);
    expect(purchased[0]!.metadata).toMatchObject({ boostType: 'instant_play_vote', creditCost: 3 });
    assertLedgerMatchesBalance(repo, 'u1');
  });

  it('rejects when the user cannot afford 3 credits', async () => {
    const { repo, service } = seedVoter(2);
    await expect(
      service.purchaseBoost({
        userId: 'u1',
        queueItemId: 'q1',
        boostType: 'instant_play_vote',
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ code: 'insufficient_credits' });
    expect(repo.users.get('u1')!.creditBalance).toBe(2);
    expect(repo.paymentEvents).toHaveLength(0);
  });

  it('is idempotent on double-submit (same key): debits once, one analytics event', async () => {
    const { repo, analytics, service } = seedVoter();
    await service.purchaseBoost({
      userId: 'u1',
      queueItemId: 'q1',
      boostType: 'instant_play_vote',
      idempotencyKey: 'same',
    });
    const second = await service.purchaseBoost({
      userId: 'u1',
      queueItemId: 'q1',
      boostType: 'instant_play_vote',
      idempotencyKey: 'same',
    });
    expect(second.creditBalance).toBe(0);
    expect(repo.queueItems.get('q1')!.instantVoteCount).toBe(1);
    expect(analytics.events.filter((e) => e.eventType === 'boost_purchased')).toHaveLength(1);
    assertLedgerMatchesBalance(repo, 'u1');
  });

  it('enforces 1 Instant Play Vote per song per user (boost_limit_reached)', async () => {
    const { repo, service } = seedVoter(6);
    await service.purchaseBoost({
      userId: 'u1',
      queueItemId: 'q1',
      boostType: 'instant_play_vote',
      idempotencyKey: 'first',
    });
    await expect(
      service.purchaseBoost({
        userId: 'u1',
        queueItemId: 'q1',
        boostType: 'instant_play_vote',
        idempotencyKey: 'second-different-key',
      }),
    ).rejects.toMatchObject({ code: 'boost_limit_reached' });
    expect(repo.users.get('u1')!.creditBalance).toBe(3);
    expect(repo.queueItems.get('q1')!.instantVoteCount).toBe(1);
    assertLedgerMatchesBalance(repo, 'u1');
  });

  it('lets the same user buy a Priority Boost AND an Instant Play Vote on one song', async () => {
    const { repo, service } = seedVoter(4);
    await service.purchaseBoost({
      userId: 'u1',
      queueItemId: 'q1',
      boostType: 'priority_boost',
      idempotencyKey: 'pb',
    });
    await service.purchaseBoost({
      userId: 'u1',
      queueItemId: 'q1',
      boostType: 'instant_play_vote',
      idempotencyKey: 'ipv',
    });
    expect(repo.users.get('u1')!.creditBalance).toBe(0);
    expect(repo.queueItems.get('q1')!.priorityBoostCount).toBe(1);
    expect(repo.queueItems.get('q1')!.instantVoteCount).toBe(1);
    assertLedgerMatchesBalance(repo, 'u1');
  });
});

describe('settleQueueItem (auto-refund, D14)', () => {
  async function boostThenGet() {
    const ctx = setup();
    ctx.repo.seedUser({ userId: 'u1', creditBalance: 3 });
    ctx.repo.seedQueueItem({ queueItemId: 'q1', venueId: 'v1' });
    await ctx.service.purchaseBoost({
      userId: 'u1',
      queueItemId: 'q1',
      boostType: 'priority_boost',
      idempotencyKey: 'boost',
    });
    return ctx;
  }

  it.each(['expired', 'skipped', 'blocked'] as QueueItemStatus[])(
    'refunds a boosted song that ends as %s',
    async (status) => {
      const { repo, analytics, service } = await boostThenGet();
      expect(repo.users.get('u1')!.creditBalance).toBe(2);

      const res = await service.settleQueueItem('q1', status);

      expect(res).toEqual({ refundedCount: 1, refundedCredits: 1 });
      expect(repo.users.get('u1')!.creditBalance).toBe(3); // credit returned
      expect(repo.paymentEvents.find((e) => e.paymentType === 'priority_boost')!.refundStatus).toBe(
        'refunded_to_credit',
      );
      expect(repo.ledger.some((e) => e.reason === 'refund' && e.delta === 1)).toBe(true);
      expect(analytics.events.map((e) => e.eventType)).toContain('refund_issued');
      assertLedgerMatchesBalance(repo, 'u1');
    },
  );

  it('does NOT refund a song that actually played', async () => {
    const { repo, service } = await boostThenGet();
    const res = await service.settleQueueItem('q1', 'played');
    expect(res.refundedCount).toBe(0);
    expect(repo.users.get('u1')!.creditBalance).toBe(2);
  });

  it('is idempotent: a second settlement refunds nothing more', async () => {
    const { repo, service } = await boostThenGet();
    await service.settleQueueItem('q1', 'expired');
    const again = await service.settleQueueItem('q1', 'expired');
    expect(again.refundedCount).toBe(0);
    expect(repo.users.get('u1')!.creditBalance).toBe(3);
    assertLedgerMatchesBalance(repo, 'u1');
  });

  it('refunds every distinct booster on a shared song', async () => {
    const { repo, service } = setup();
    repo.seedUser({ userId: 'u1', creditBalance: 1 });
    repo.seedUser({ userId: 'u2', creditBalance: 1 });
    repo.seedQueueItem({ queueItemId: 'q1', venueId: 'v1' });
    await service.purchaseBoost({
      userId: 'u1',
      queueItemId: 'q1',
      boostType: 'priority_boost',
      idempotencyKey: 'b1',
    });
    await service.purchaseBoost({
      userId: 'u2',
      queueItemId: 'q1',
      boostType: 'priority_boost',
      idempotencyKey: 'b2',
    });

    const res = await service.settleQueueItem('q1', 'skipped');
    expect(res).toEqual({ refundedCount: 2, refundedCredits: 2 });
    expect(repo.users.get('u1')!.creditBalance).toBe(1);
    expect(repo.users.get('u2')!.creditBalance).toBe(1);
  });

  it('refunds an Instant Play Vote (3 credits) on a song that never plays', async () => {
    const { repo, analytics, service } = setup();
    repo.seedUser({ userId: 'u1', creditBalance: 3 });
    repo.seedQueueItem({ queueItemId: 'q1', venueId: 'v1' });
    await service.purchaseBoost({
      userId: 'u1',
      queueItemId: 'q1',
      boostType: 'instant_play_vote',
      idempotencyKey: 'ipv',
    });
    expect(repo.users.get('u1')!.creditBalance).toBe(0);

    const res = await service.settleQueueItem('q1', 'expired');
    expect(res).toEqual({ refundedCount: 1, refundedCredits: 3 });
    expect(repo.users.get('u1')!.creditBalance).toBe(3);
    expect(repo.paymentEvents.find((e) => e.paymentType === 'instant_play_vote')!.refundStatus).toBe(
      'refunded_to_credit',
    );
    expect(analytics.events.map((e) => e.eventType)).toContain('refund_issued');
    assertLedgerMatchesBalance(repo, 'u1');
  });

  it('refunds a mix of Priority Boost + Instant Play Vote on one dropped song', async () => {
    const { repo, service } = setup();
    repo.seedUser({ userId: 'u1', creditBalance: 1 });
    repo.seedUser({ userId: 'u2', creditBalance: 3 });
    repo.seedQueueItem({ queueItemId: 'q1', venueId: 'v1' });
    await service.purchaseBoost({
      userId: 'u1',
      queueItemId: 'q1',
      boostType: 'priority_boost',
      idempotencyKey: 'pb',
    });
    await service.purchaseBoost({
      userId: 'u2',
      queueItemId: 'q1',
      boostType: 'instant_play_vote',
      idempotencyKey: 'ipv',
    });

    const res = await service.settleQueueItem('q1', 'blocked');
    expect(res).toEqual({ refundedCount: 2, refundedCredits: 4 });
    expect(repo.users.get('u1')!.creditBalance).toBe(1);
    expect(repo.users.get('u2')!.creditBalance).toBe(3);
    assertLedgerMatchesBalance(repo, 'u1');
    assertLedgerMatchesBalance(repo, 'u2');
  });
});

describe('redeemBoostCode (Boost Codes, D7)', () => {
  function seedRedeemer(creditBalance = 0) {
    const ctx = setup();
    ctx.repo.seedUser({ userId: 'u1', creditBalance });
    return ctx;
  }

  it('credits the tier value, writes a promo_code_redemption event + ledger, emits analytics', async () => {
    const { repo, analytics, service } = seedRedeemer();
    repo.seedBoostCode({ code: 'BEER-1', venueId: 'v1', tier: 'cocktail', creditValue: 2 });

    const res = await service.redeemBoostCode({
      userId: 'u1',
      code: 'BEER-1',
      idempotencyKey: 'r1',
    });

    expect(res).toEqual({ tier: 'cocktail', creditsAdded: 2, creditBalance: 2 });
    const event = repo.paymentEvents.find((e) => e.paymentType === 'promo_code_redemption');
    expect(event).toMatchObject({ status: 'completed', creditAmount: 2, venueId: 'v1' });
    expect(repo.ledger.some((e) => e.reason === 'promo_code_redemption' && e.delta === 2)).toBe(true);
    const code = repo.boostCodes.get('BEER-1')!;
    expect(code.redeemedBy).toBe('u1');
    expect(code.redeemedAt).not.toBeNull();
    expect(analytics.events.map((e) => e.eventType)).toContain('promo_code_redeemed');
    assertLedgerMatchesBalance(repo, 'u1');
  });

  it('rejects an unknown code (boost_code_invalid) without crediting', async () => {
    const { repo, service } = seedRedeemer();
    await expect(
      service.redeemBoostCode({ userId: 'u1', code: 'NOPE', idempotencyKey: 'r' }),
    ).rejects.toMatchObject({ code: 'boost_code_invalid' });
    expect(repo.users.get('u1')!.creditBalance).toBe(0);
    expect(repo.paymentEvents).toHaveLength(0);
  });

  it('rejects an expired code (boost_code_expired)', async () => {
    const { repo, service } = seedRedeemer();
    repo.seedBoostCode({
      code: 'OLD',
      venueId: 'v1',
      tier: 'beer',
      creditValue: 1,
      expiresAt: new Date(Date.now() - 60_000),
    });
    await expect(
      service.redeemBoostCode({ userId: 'u1', code: 'OLD', idempotencyKey: 'r' }),
    ).rejects.toMatchObject({ code: 'boost_code_expired' });
    expect(repo.users.get('u1')!.creditBalance).toBe(0);
  });

  it('rejects a code already redeemed by someone else (boost_code_already_redeemed)', async () => {
    const { repo, service } = seedRedeemer();
    repo.seedBoostCode({
      code: 'USED',
      venueId: 'v1',
      tier: 'bottle',
      creditValue: 10,
      redeemedBy: 'someone',
      redeemedAt: new Date(),
    });
    await expect(
      service.redeemBoostCode({ userId: 'u1', code: 'USED', idempotencyKey: 'r' }),
    ).rejects.toMatchObject({ code: 'boost_code_already_redeemed' });
    expect(repo.users.get('u1')!.creditBalance).toBe(0);
  });

  it('is idempotent on the same key: credits once, one analytics event, one ledger entry', async () => {
    const { repo, analytics, service } = seedRedeemer();
    repo.seedBoostCode({ code: 'B10', venueId: 'v1', tier: 'bottle', creditValue: 10 });

    const first = await service.redeemBoostCode({ userId: 'u1', code: 'B10', idempotencyKey: 'same' });
    const second = await service.redeemBoostCode({ userId: 'u1', code: 'B10', idempotencyKey: 'same' });

    expect(first).toEqual({ tier: 'bottle', creditsAdded: 10, creditBalance: 10 });
    expect(second.creditBalance).toBe(10);
    expect(repo.paymentEvents.filter((e) => e.paymentType === 'promo_code_redemption')).toHaveLength(1);
    expect(repo.ledger.filter((e) => e.reason === 'promo_code_redemption')).toHaveLength(1);
    expect(analytics.events.filter((e) => e.eventType === 'promo_code_redeemed')).toHaveLength(1);
    assertLedgerMatchesBalance(repo, 'u1');
  });

  it('treats the expiry boundary as inclusive (expiresAt == now → expired)', async () => {
    const { repo, service } = seedRedeemer();
    const now = new Date('2026-09-03T12:00:00Z');
    repo.seedBoostCode({ code: 'EDGE', venueId: 'v1', tier: 'beer', creditValue: 1, expiresAt: now });
    await expect(
      service.redeemBoostCode({ userId: 'u1', code: 'EDGE', idempotencyKey: 'r', now }),
    ).rejects.toMatchObject({ code: 'boost_code_expired' });
  });
});

describe('venuePayouts (rev-share, D15)', () => {
  it('aggregates completed cash purchases and applies the 70/30 split', async () => {
    const { repo, service } = setup();
    repo.seedUser({ userId: 'u1', creditBalance: 0 });
    // Two starter bundles ($4.99 each) at v1 → gross 998.
    await service.purchaseCredits({
      userId: 'u1',
      venueId: 'v1',
      bundleId: 'starter_5',
      paymentMethodToken: 'pm',
      idempotencyKey: 'p1',
    });
    await service.purchaseCredits({
      userId: 'u1',
      venueId: 'v1',
      bundleId: 'starter_5',
      paymentMethodToken: 'pm',
      idempotencyKey: 'p2',
    });

    const payouts = await service.venuePayouts('v1');
    expect(payouts).toHaveLength(1);
    const payout = payouts[0]!;
    expect(payout.grossCents).toBe(998);
    expect(payout.completedPurchaseCount).toBe(2);
    // app = floor(998 * 0.30) = 299; venue keeps the remainder = 699.
    expect(payout.appCents).toBe(299);
    expect(payout.venueCents).toBe(699);
    expect(payout.venueCents + payout.appCents).toBe(998);
  });

  it('excludes boosts (no cash) from venue payouts', async () => {
    const { repo, service } = setup();
    repo.seedUser({ userId: 'u1', creditBalance: 5 });
    repo.seedQueueItem({ queueItemId: 'q1', venueId: 'v1' });
    await service.purchaseBoost({
      userId: 'u1',
      queueItemId: 'q1',
      boostType: 'priority_boost',
      idempotencyKey: 'b',
    });
    const payouts = await service.venuePayouts('v1');
    expect(payouts).toHaveLength(0);
  });
});

describe('error typing', () => {
  it('throws PaymentsError instances carrying an HTTP status', async () => {
    const { repo, service } = setup();
    repo.seedUser({ userId: 'u1' });
    try {
      await service.purchaseCredits({
        userId: 'u1',
        venueId: 'v1',
        bundleId: 'ghost',
        paymentMethodToken: 'pm',
        idempotencyKey: 'k',
      });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(isPaymentsError(err)).toBe(true);
      if (isPaymentsError(err)) expect(err.statusCode).toBe(404);
    }
  });
});
