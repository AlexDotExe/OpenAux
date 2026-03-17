/**
 * Boost Payment Service
 *
 * Handles Stripe payment intent creation for song boosts.
 * Users pay to boost a song request to the top of the queue.
 * Integrates with Stripe for in-app payment processing (no redirects).
 */

export interface BoostPayload {
  requestId: string;
  userId: string;
  boostAmount: number; // USD cents
}

export interface BoostResult {
  success: boolean;
  boostMultiplier: number;
  transactionId?: string;
}

export async function processBoostPayment(payload: BoostPayload): Promise<BoostResult> {
  const res = await fetch('/api/payments/create-intent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestId: payload.requestId,
      userId: payload.userId,
    }),
  });

  if (!res.ok) {
    const data = await res.json();
    console.error('[processBoostPayment] Failed to create intent:', data.error);
    return { success: false, boostMultiplier: 1.0 };
  }

  const data = await res.json();
  return {
    success: true,
    boostMultiplier: 2.0,
    transactionId: data.paymentIntentId,
  };
}

