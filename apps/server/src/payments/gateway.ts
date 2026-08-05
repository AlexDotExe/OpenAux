/**
 * PaymentGateway — the injectable seam between settlement and the card processor.
 *
 * Settlement code depends only on this interface. `StripeGateway` talks to the
 * Stripe REST API over `fetch`; `FakeGateway` is a deterministic in-memory
 * double for unit tests (no network, no live Stripe).
 */

export interface CreatePaymentIntentParams {
  amountCents: number;
  currency: string;
  /** Tokenized payment method (e.g. `pm_...` / `pmToken`) from the client. */
  paymentMethodToken: string;
  /** Passed to Stripe as the Idempotency-Key header. */
  idempotencyKey: string;
  metadata?: Record<string, string>;
}

export type PaymentIntentStatus = 'succeeded' | 'requires_action' | 'failed';

export interface PaymentIntentResult {
  id: string;
  status: PaymentIntentStatus;
  amountCents: number;
  /** Raw provider payload, retained for reconciliation/debugging. */
  raw?: unknown;
}

export interface PaymentGateway {
  /**
   * Create and confirm a PaymentIntent in one call. Implementations MUST honor
   * `idempotencyKey` so a retried request never double-charges.
   */
  createAndConfirmPaymentIntent(params: CreatePaymentIntentParams): Promise<PaymentIntentResult>;
}

// ---------------------------------------------------------------------------
// StripeGateway — real processor over the Stripe REST API via fetch.
// ---------------------------------------------------------------------------

interface StripeGatewayOptions {
  /** Defaults to process.env.STRIPE_SECRET_KEY. */
  secretKey?: string;
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

export class StripeGateway implements PaymentGateway {
  private readonly secretKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(options: StripeGatewayOptions = {}) {
    const secretKey = options.secretKey ?? process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new Error('StripeGateway requires STRIPE_SECRET_KEY (env or option).');
    }
    this.secretKey = secretKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = options.baseUrl ?? 'https://api.stripe.com';
  }

  async createAndConfirmPaymentIntent(
    params: CreatePaymentIntentParams,
  ): Promise<PaymentIntentResult> {
    const form = new URLSearchParams();
    form.set('amount', String(params.amountCents));
    form.set('currency', params.currency);
    form.set('payment_method', params.paymentMethodToken);
    form.set('confirm', 'true');
    // Never redirect a patron mid-song; keep the charge on-session.
    form.set('automatic_payment_methods[enabled]', 'true');
    form.set('automatic_payment_methods[allow_redirects]', 'never');
    for (const [key, value] of Object.entries(params.metadata ?? {})) {
      form.set(`metadata[${key}]`, value);
    }

    const res = await this.fetchImpl(`${this.baseUrl}/v1/payment_intents`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        // Stripe-native idempotency: safe to retry the same key.
        'Idempotency-Key': params.idempotencyKey,
      },
      body: form.toString(),
    });

    const body = (await res.json()) as {
      id?: string;
      status?: string;
      amount?: number;
      error?: { message?: string };
    };

    if (!res.ok) {
      return {
        id: body.id ?? 'unknown',
        status: 'failed',
        amountCents: params.amountCents,
        raw: body,
      };
    }

    return {
      id: body.id ?? 'unknown',
      status: mapStripeStatus(body.status),
      amountCents: body.amount ?? params.amountCents,
      raw: body,
    };
  }
}

function mapStripeStatus(status: string | undefined): PaymentIntentStatus {
  switch (status) {
    case 'succeeded':
      return 'succeeded';
    case 'requires_action':
    case 'requires_confirmation':
    case 'processing':
      return 'requires_action';
    default:
      return 'failed';
  }
}

// ---------------------------------------------------------------------------
// FakeGateway — deterministic double for tests.
// ---------------------------------------------------------------------------

interface FakeGatewayOptions {
  /** Force every charge to resolve with this status. Defaults to 'succeeded'. */
  status?: PaymentIntentStatus;
}

export class FakeGateway implements PaymentGateway {
  private readonly status: PaymentIntentStatus;
  private counter = 0;
  /** Records every call for assertions. */
  readonly calls: CreatePaymentIntentParams[] = [];
  /** Maps idempotencyKey → prior result to simulate Stripe idempotency. */
  private readonly seen = new Map<string, PaymentIntentResult>();

  constructor(options: FakeGatewayOptions = {}) {
    this.status = options.status ?? 'succeeded';
  }

  async createAndConfirmPaymentIntent(
    params: CreatePaymentIntentParams,
  ): Promise<PaymentIntentResult> {
    this.calls.push(params);
    const prior = this.seen.get(params.idempotencyKey);
    if (prior) return prior;

    const result: PaymentIntentResult = {
      id: `pi_fake_${++this.counter}`,
      status: this.status,
      amountCents: params.amountCents,
    };
    this.seen.set(params.idempotencyKey, result);
    return result;
  }
}
