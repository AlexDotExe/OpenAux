import { describe, expect, it, vi } from 'vitest';
import { FakeGateway, StripeGateway } from './gateway.js';

describe('FakeGateway', () => {
  it('succeeds by default and records calls', async () => {
    const gw = new FakeGateway();
    const r = await gw.createAndConfirmPaymentIntent({
      amountCents: 499,
      currency: 'usd',
      paymentMethodToken: 'pm_1',
      idempotencyKey: 'k1',
    });
    expect(r.status).toBe('succeeded');
    expect(r.amountCents).toBe(499);
    expect(gw.calls).toHaveLength(1);
  });

  it('is idempotent: same key returns the same intent', async () => {
    const gw = new FakeGateway();
    const a = await gw.createAndConfirmPaymentIntent({
      amountCents: 499,
      currency: 'usd',
      paymentMethodToken: 'pm_1',
      idempotencyKey: 'dup',
    });
    const b = await gw.createAndConfirmPaymentIntent({
      amountCents: 499,
      currency: 'usd',
      paymentMethodToken: 'pm_1',
      idempotencyKey: 'dup',
    });
    expect(b.id).toBe(a.id);
  });

  it('can be forced to fail', async () => {
    const gw = new FakeGateway({ status: 'failed' });
    const r = await gw.createAndConfirmPaymentIntent({
      amountCents: 499,
      currency: 'usd',
      paymentMethodToken: 'pm_1',
      idempotencyKey: 'k',
    });
    expect(r.status).toBe('failed');
  });
});

describe('StripeGateway', () => {
  it('requires a secret key', () => {
    expect(() => new StripeGateway({ secretKey: '' })).toThrow(/STRIPE_SECRET_KEY/);
  });

  it('POSTs a confirmed PaymentIntent with the idempotency header', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: 'pi_1', status: 'succeeded', amount: 499 }),
    })) as unknown as typeof fetch;

    const gw = new StripeGateway({ secretKey: 'sk_test_x', fetchImpl });
    const r = await gw.createAndConfirmPaymentIntent({
      amountCents: 499,
      currency: 'usd',
      paymentMethodToken: 'pm_1',
      idempotencyKey: 'idem-1',
      metadata: { userId: 'u1' },
    });

    expect(r).toMatchObject({ id: 'pi_1', status: 'succeeded', amountCents: 499 });
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const url = call[0] as string;
    const init = call[1] as { headers: Record<string, string>; body: string };
    expect(url).toBe('https://api.stripe.com/v1/payment_intents');
    expect(init.headers.Authorization).toBe('Bearer sk_test_x');
    expect(init.headers['Idempotency-Key']).toBe('idem-1');
    expect(init.body).toContain('amount=499');
    expect(init.body).toContain('currency=usd');
    expect(init.body).toContain('confirm=true');
    expect(init.body).toContain('metadata%5BuserId%5D=u1');
  });

  it('maps a non-ok response to failed', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      json: async () => ({ error: { message: 'card_declined' } }),
    })) as unknown as typeof fetch;

    const gw = new StripeGateway({ secretKey: 'sk_test_x', fetchImpl });
    const r = await gw.createAndConfirmPaymentIntent({
      amountCents: 499,
      currency: 'usd',
      paymentMethodToken: 'pm_bad',
      idempotencyKey: 'idem-2',
    });
    expect(r.status).toBe('failed');
  });

  it('maps requires_action statuses', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: 'pi_2', status: 'requires_action', amount: 499 }),
    })) as unknown as typeof fetch;

    const gw = new StripeGateway({ secretKey: 'sk_test_x', fetchImpl });
    const r = await gw.createAndConfirmPaymentIntent({
      amountCents: 499,
      currency: 'usd',
      paymentMethodToken: 'pm_1',
      idempotencyKey: 'idem-3',
    });
    expect(r.status).toBe('requires_action');
  });
});
