'use client';

import { useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { CREDIT_BUNDLES, CreditBundleKey } from '@/lib/constants';

const stripePromise = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
  : null;

interface CreditPurchaseModalProps {
  onClose: () => void;
}

/** Inner Stripe payment form rendered inside <Elements> */
function CreditPaymentForm({
  credits,
  price,
  authToken,
  onSuccess,
  onCancel,
}: {
  credits: number;
  price: number;
  authToken: string;
  onSuccess: (newBalance: number) => void;
  onCancel: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [status, setStatus] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setProcessing(true);
    setStatus(null);

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
    });

    if (error) {
      setStatus(`Payment failed: ${error.message}`);
      setProcessing(false);
      return;
    }

    if (paymentIntent?.status !== 'succeeded') {
      setStatus('Payment did not complete. Please try again.');
      setProcessing(false);
      return;
    }

    // Confirm with the server to credit the balance
    try {
      const res = await fetch('/api/credits/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentIntentId: paymentIntent.id, authToken }),
      });
      const data = await res.json();

      if (res.ok) {
        setStatus(`✅ ${credits} credits added to your account!`);
        setTimeout(() => onSuccess(data.creditBalance), 1500);
      } else {
        setStatus(`Error: ${data.error}`);
        setProcessing(false);
      }
    } catch {
      setStatus('Failed to confirm purchase. Please contact support.');
      setProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement />
      {status && (
        <p
          className={
            status.startsWith('✅')
              ? 'text-green-400 text-sm'
              : 'text-red-400 text-sm'
          }
        >
          {status}
        </p>
      )}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={processing}
          className="flex-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-white py-2 rounded-lg font-semibold"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!stripe || processing}
          className="flex-1 bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white py-2 rounded-lg font-semibold"
        >
          {processing ? 'Processing…' : `Pay $${price.toFixed(2)}`}
        </button>
      </div>
    </form>
  );
}

export function CreditPurchaseModal({ onClose }: CreditPurchaseModalProps) {
  const { creditBalance, authToken, setCreditBalance } = useSessionStore();
  const [selectedBundle, setSelectedBundle] = useState<CreditBundleKey | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loadingIntent, setLoadingIntent] = useState(false);
  const [intentError, setIntentError] = useState<string | null>(null);

  const handleSelectBundle = async (bundleKey: CreditBundleKey) => {
    if (!stripePromise) {
      setIntentError('Payment is not configured. Please try again later.');
      return;
    }
    if (!authToken) {
      setIntentError('Please sign in to purchase credits.');
      return;
    }

    setSelectedBundle(bundleKey);
    setClientSecret(null);
    setIntentError(null);
    setLoadingIntent(true);

    try {
      const res = await fetch('/api/credits/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bundleKey, authToken }),
      });
      const data = await res.json();

      if (res.ok) {
        setClientSecret(data.clientSecret);
      } else {
        setIntentError(data.error ?? 'Failed to initialize payment.');
      }
    } catch {
      setIntentError('Network error. Please try again.');
    } finally {
      setLoadingIntent(false);
    }
  };

  const handlePurchaseSuccess = (newBalance: number) => {
    setCreditBalance(newBalance);
    onClose();
  };

  const bundle = selectedBundle ? CREDIT_BUNDLES.find((b) => b.key === selectedBundle) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-sm p-6 shadow-2xl space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">💳 Buy Credits</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors text-xl leading-none"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Current balance */}
        <div className="bg-gray-800 rounded-lg px-4 py-3 flex items-center justify-between">
          <span className="text-sm text-gray-400">Current Balance</span>
          <span className="text-lg font-bold text-green-400">
            {creditBalance.toFixed(2)} credits
          </span>
        </div>

        {/* Bundle selection or payment form */}
        {!selectedBundle ? (
          <>
            <p className="text-sm text-gray-400">
              Use credits to boost songs in the queue without re-entering payment
              details each time.
            </p>
            <div className="space-y-2">
              {CREDIT_BUNDLES.map((b) => (
                <button
                  key={b.key}
                  onClick={() => handleSelectBundle(b.key)}
                  className="w-full flex items-center justify-between bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-green-600 text-white rounded-xl px-4 py-3 transition-colors"
                >
                  <span className="font-semibold">{b.credits} Credits</span>
                  <div className="flex items-center gap-2">
                    {('badge' in b) && b.badge && (
                      <span className="text-xs bg-green-700 text-white px-2 py-0.5 rounded-full">
                        {b.badge as string}
                      </span>
                    )}
                    <span className="text-green-400 font-bold">${b.price.toFixed(2)}</span>
                  </div>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            {/* Back to bundle selection */}
            <button
              onClick={() => {
                setSelectedBundle(null);
                setClientSecret(null);
                setIntentError(null);
              }}
              className="text-sm text-gray-400 hover:text-white flex items-center gap-1 transition-colors"
            >
              ← Back
            </button>

            {bundle && (
              <div className="bg-gray-800 rounded-lg px-4 py-3 flex items-center justify-between">
                <span className="text-sm text-white font-semibold">{bundle.credits} Credits</span>
                <span className="text-green-400 font-bold">${bundle.price.toFixed(2)}</span>
              </div>
            )}

            {intentError && (
              <p className="text-red-400 text-sm">{intentError}</p>
            )}

            {loadingIntent ? (
              <p className="text-gray-400 animate-pulse text-center py-4">
                Loading payment form…
              </p>
            ) : clientSecret && stripePromise && bundle ? (
              <Elements
                stripe={stripePromise}
                options={{
                  clientSecret,
                  appearance: { theme: 'night', labels: 'floating' },
                }}
              >
                <CreditPaymentForm
                  credits={bundle.credits}
                  price={bundle.price}
                  authToken={authToken!}
                  onSuccess={handlePurchaseSuccess}
                  onCancel={() => {
                    setSelectedBundle(null);
                    setClientSecret(null);
                  }}
                />
              </Elements>
            ) : !intentError ? (
              <p className="text-gray-400 text-sm text-center py-4">
                Unable to load payment form. Please try again.
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
