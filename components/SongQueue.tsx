'use client';

import { useState, useEffect, useRef } from 'react';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { loadStripe } from '@stripe/stripe-js';
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';

// Lazy-load Stripe to avoid blocking initial render
const stripePromise = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
  : null;

// Average pop/club song duration used when actual durationMs is not available in the database.
const DEFAULT_SONG_DURATION_MS = 3.5 * 60 * 1000;

const REFUND_POLICY_MESSAGE =
  "If your song doesn't get played, you'll receive a full refund to your original payment method. " +
  'This is a one-time, immediate payment — no tokens or bulk purchases.';

interface Song {
  requestId: string;
  songId: string;
  title: string;
  artist: string;
  score: number;
  voteCount: number;
  durationMs?: number;
  userVote?: 1 | -1;
  isBoosted?: boolean;
  boostAmount?: number;
  userId?: string;
}

interface Props {
  queue: Song[];
  onVote: (requestId: string, value: 1 | -1) => void;
  currentUserId?: string;
  boostPrice?: number;
  monetizationEnabled?: boolean;
  nowPlayingRemainingMs?: number;
  onBoostSuccess?: () => void;
}

/**
 * Calculate estimated wait time in milliseconds for a song at the given queue index.
 */
function calculateWaitTimeMs(songs: Song[], index: number, nowPlayingRemainingMs: number): number {
  let waitMs = nowPlayingRemainingMs;
  for (let i = 0; i < index; i++) {
    waitMs += songs[i].durationMs ?? DEFAULT_SONG_DURATION_MS;
  }
  return waitMs;
}

function formatWaitTime(ms: number): string {
  const minutes = Math.round(ms / 60000);
  return minutes < 1 ? '< 1 min' : `~${minutes} min`;
}

function formatPrice(price: number): string {
  return price % 1 === 0 ? `$${price.toFixed(0)}` : `$${price.toFixed(2)}`;
}

/** Small inline "ⓘ" tooltip that shows the refund policy on hover/focus. */
function RefundPolicyTooltip() {
  const [visible, setVisible] = useState(false);

  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        aria-label="Refund policy information"
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onFocus={() => setVisible(true)}
        onBlur={() => setVisible(false)}
        className="text-gray-400 hover:text-yellow-300 focus:outline-none text-xs leading-none"
      >
        ⓘ
      </button>
      {visible && (
        <span
          role="tooltip"
          className="absolute bottom-full right-0 mb-2 w-56 rounded-lg bg-gray-800 border border-gray-600 px-3 py-2 text-xs text-gray-200 shadow-lg z-10 pointer-events-none text-left"
        >
          {REFUND_POLICY_MESSAGE}
        </span>
      )}
    </span>
  );
}

// Inner payment form rendered inside <Elements>
function StripeBoostForm({
  requestId,
  userId,
  boostPrice,
  onSuccess,
  onCancel,
}: {
  requestId: string;
  userId: string;
  boostPrice: number;
  onSuccess: () => void;
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

    const res = await fetch(`/api/requests/${requestId}/boost`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, stripePaymentIntentId: paymentIntent.id }),
    });

    const data = await res.json();

    if (res.ok) {
      setStatus('Song boosted +3 spots up the queue!');
      setTimeout(() => onSuccess(), 1500);
    } else {
      setStatus(`Error: ${data.error}`);
      setProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement />
      {status && (
        <p className={status.startsWith('Error') ? 'text-red-400 text-sm' : 'text-green-400 text-sm'}>
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
          className="flex-1 bg-yellow-600 hover:bg-yellow-700 disabled:opacity-40 text-black py-2 rounded-lg font-semibold"
        >
          {processing ? 'Processing...' : `Pay $${boostPrice.toFixed(2)}`}
        </button>
      </div>
    </form>
  );
}

export function SongQueue({ queue, onVote, currentUserId, boostPrice = 5.0, monetizationEnabled = false, nowPlayingRemainingMs = 0, onBoostSuccess }: Props) {
  const { queue: storeQueue, creditBalance, authToken, setCreditBalance } = useSessionStore();
  const displayQueue = queue.length > 0 ? queue : storeQueue;
  const [boostingRequestId, setBoostingRequestId] = useState<string | null>(null);
  const [showBoostModal, setShowBoostModal] = useState(false);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [boostStatus, setBoostStatus] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loadingIntent, setLoadingIntent] = useState(false);
  // Track which payment method is selected in the modal: 'stripe' | 'credits'
  const [boostPaymentMethod, setBoostPaymentMethod] = useState<'stripe' | 'credits'>('stripe');

  // Track queue position changes to show movement indicators
  const prevPositionsRef = useRef<Map<string, number>>(new Map());
  const [positionChanges, setPositionChanges] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    const currentPositions = new Map<string, number>();
    const newChanges = new Map<string, number>();

    displayQueue.forEach((song, idx) => {
      currentPositions.set(song.requestId, idx);
      const prevIdx = prevPositionsRef.current.get(song.requestId);
      if (prevIdx !== undefined && prevIdx !== idx) {
        // Positive delta = moved up in queue (toward position 0)
        newChanges.set(song.requestId, prevIdx - idx);
      }
    });

    prevPositionsRef.current = currentPositions;
    setPositionChanges(newChanges);

    if (newChanges.size > 0) {
      const timer = setTimeout(() => setPositionChanges(new Map()), 4000);
      return () => clearTimeout(timer);
    }
  }, [displayQueue]);

  const handleBoostClick = async (requestId: string) => {
    setSelectedRequestId(requestId);
    setBoostStatus(null);
    setClientSecret(null);
    // Default to credits if user has enough, otherwise stripe
    setBoostPaymentMethod(creditBalance >= boostPrice ? 'credits' : 'stripe');

    if (boostPrice > 0 && stripePromise) {
      // Paid boost: open modal; load stripe intent in background for stripe path
      setShowBoostModal(true);
    } else {
      // Free boost: show simple confirmation
      setShowBoostModal(true);
    }
  };

  const loadStripeIntent = async (requestId: string) => {
    setLoadingIntent(true);
    setBoostStatus(null);
    try {
      const res = await fetch('/api/payments/create-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, userId: currentUserId }),
      });
      const data = await res.json();

      if (res.ok) {
        setClientSecret(data.clientSecret);
      } else {
        setBoostStatus(`Error: ${data.error}`);
      }
    } catch {
      setBoostStatus('Failed to initialize payment. Please try again.');
    } finally {
      setLoadingIntent(false);
    }
  };

  const confirmFreeBoost = async () => {
    if (!selectedRequestId || !currentUserId) return;

    setBoostingRequestId(selectedRequestId);
    setBoostStatus(null);

    try {
      const res = await fetch(`/api/requests/${selectedRequestId}/boost`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUserId }),
      });

      const data = await res.json();

      if (res.ok) {
        setBoostStatus('Success! Your song has been boosted +3 spots up the queue!');
        setTimeout(() => {
          closeModal();
          if (onBoostSuccess) onBoostSuccess();
        }, 2000);
      } else {
        setBoostStatus(`Error: ${data.error}`);
      }
    } catch {
      setBoostStatus('Failed to boost song. Please try again.');
    } finally {
      setBoostingRequestId(null);
    }
  };

  const confirmCreditBoost = async () => {
    if (!selectedRequestId || !currentUserId || !authToken) return;

    setBoostingRequestId(selectedRequestId);
    setBoostStatus(null);

    try {
      const res = await fetch(`/api/requests/${selectedRequestId}/boost`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUserId, useCredits: true, authToken }),
      });

      const data = await res.json();

      if (res.ok) {
        // Refresh credit balance after deduction
        const balanceRes = await fetch('/api/credits/balance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ authToken }),
        });
        if (balanceRes.ok) {
          const balanceData = await balanceRes.json();
          setCreditBalance(balanceData.creditBalance);
        }
        setBoostStatus('Success! Your song has been boosted +3 spots up the queue!');
        setTimeout(() => {
          closeModal();
          if (onBoostSuccess) onBoostSuccess();
        }, 2000);
      } else {
        setBoostStatus(`Error: ${data.error}`);
      }
    } catch {
      setBoostStatus('Failed to boost song. Please try again.');
    } finally {
      setBoostingRequestId(null);
    }
  };

  const closeModal = () => {
    setShowBoostModal(false);
    setClientSecret(null);
    setBoostStatus(null);
    setBoostingRequestId(null);
    setBoostPaymentMethod('stripe');
  };

  if (displayQueue.length === 0) {
    return (
      <div className="bg-gray-900 rounded-xl p-4 text-center">
        <p className="text-gray-400">No songs in the queue yet.</p>
        <p className="text-gray-500 text-sm mt-1">Be the first to request one!</p>
      </div>
    );
  }

  const canBoost = (song: Song, idx: number) => {
    return (
      idx >= 2 &&
      currentUserId &&
      song.userId === currentUserId &&
      !song.isBoosted
    );
  };

  const isUserSong = (song: Song) => {
    return currentUserId && song.userId === currentUserId;
  };

  return (
    <>
      <div className="space-y-3">
        <h2 className="font-semibold">🎵 Song Queue</h2>
        {displayQueue.map((song, idx) => (
          <div key={song.requestId}>
            {/* Song Card */}
            <div
              className={`rounded-xl p-4 space-y-3 ${
                song.isBoosted
                  ? 'bg-yellow-900/20 border border-yellow-700'
                  : idx === 0
                  ? 'bg-gray-900 border border-green-700'
                  : isUserSong(song)
                  ? 'bg-gray-900 border border-blue-700'
                  : 'bg-gray-900'
              }`}
            >
              {/* Top row: Position, Song info, Vote buttons, Score */}
              <div className="flex items-center gap-3">
                <span className="text-gray-600 font-mono text-sm w-5 shrink-0">
                  {song.isBoosted && '⚡'}
                  {idx === 0 ? '▶' : `${idx + 1}`}
                </span>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium truncate">{song.title}</p>
                    {song.isBoosted && (
                      <span className="text-xs bg-yellow-600 text-black px-2 py-0.5 rounded-full font-semibold shrink-0">
                        BOOSTED
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="text-gray-400 text-sm truncate">{song.artist}</p>
                    {/* Inline position label */}
                    <span className={`text-[11px] font-medium shrink-0 ${
                      idx === 0 ? 'text-green-400' : 'text-gray-500'
                    }`}>
                      {idx === 0
                        ? 'Playing Now'
                        : idx === 1
                        ? 'Up Next'
                        : `${idx + 1}${idx + 1 === 2 ? 'nd' : idx + 1 === 3 ? 'rd' : 'th'} in Queue`
                      }
                    </span>
                  </div>
                  {/* User's song: wait time + position change */}
                  {isUserSong(song) && idx > 0 && (
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] text-blue-400">
                        ~{formatWaitTime(calculateWaitTimeMs(displayQueue, idx, nowPlayingRemainingMs))} wait
                      </span>
                      {(() => {
                        const change = positionChanges.get(song.requestId);
                        if (!change) return null;
                        return (
                          <span className={`text-[11px] font-semibold ${change > 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {change > 0 ? `▲${change}` : `▼${Math.abs(change)}`}
                          </span>
                        );
                      })()}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => onVote(song.requestId, 1)}
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm transition-colors ${
                      song.userVote === 1
                        ? 'bg-green-600 text-white'
                        : 'bg-gray-800 hover:bg-green-900 text-gray-400'
                    }`}
                  >
                    ↑
                  </button>
                  <span className="text-xs text-gray-400 w-4 text-center">{song.voteCount}</span>
                  <button
                    onClick={() => onVote(song.requestId, -1)}
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm transition-colors ${
                      song.userVote === -1
                        ? 'bg-red-600 text-white'
                        : 'bg-gray-800 hover:bg-red-900 text-gray-400'
                    }`}
                  >
                    ↓
                  </button>
                </div>

                <div className="text-xs text-gray-500 shrink-0">{song.score.toFixed(1)}</div>
              </div>

              {/* Bottom row: Boost button */}
              {canBoost(song, idx) && (() => {
                const currentWaitMs = calculateWaitTimeMs(displayQueue, idx, nowPlayingRemainingMs);
                const boostedIdx = Math.max(0, idx - 3);
                const boostedWaitMs = calculateWaitTimeMs(displayQueue, boostedIdx, nowPlayingRemainingMs);
                const savingsMs = currentWaitMs - boostedWaitMs;
                return (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleBoostClick(song.requestId)}
                        disabled={!!boostingRequestId}
                        className={`flex-1 text-sm font-semibold py-2 rounded-lg transition-colors ${
                          boostPrice === 0
                            ? 'bg-green-600 hover:bg-green-700 text-white'
                            : 'bg-yellow-600 hover:bg-yellow-700 text-black'
                        } disabled:opacity-40`}
                      >
                        ⚡ {boostPrice === 0 ? `Boost to #${boostedIdx + 1} (Free)` : `Boost to #${boostedIdx + 1} for ${formatPrice(boostPrice)}`}
                      </button>
                      {boostPrice > 0 && <RefundPolicyTooltip />}
                    </div>
                    {savingsMs > 0 && (
                      <p className="text-xs text-yellow-400 text-center">
                        Boost to save {formatWaitTime(savingsMs)}
                      </p>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        ))}
      </div>

      {/* Boost Modal */}
      {showBoostModal && (() => {
        const selectedIdx = selectedRequestId ? displayQueue.findIndex(s => s.requestId === selectedRequestId) : -1;
        const boostedIdx = Math.max(0, selectedIdx - 3);
        const savingsMs = selectedIdx > 0
          ? calculateWaitTimeMs(displayQueue, selectedIdx, nowPlayingRemainingMs) - calculateWaitTimeMs(displayQueue, boostedIdx, nowPlayingRemainingMs)
          : 0;
        const hasEnoughCredits = creditBalance >= boostPrice;
        return (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
            <div className="bg-gray-900 rounded-xl p-6 max-w-sm w-full space-y-4">
              <h3 className="text-xl font-bold">⚡ Priority Boost</h3>

              {/* Paid boost */}
              {boostPrice > 0 ? (
                boostStatus ? (
                  <div className="text-center space-y-4">
                    <p className={boostStatus.startsWith('Error') ? 'text-red-400' : 'text-green-400'}>
                      {boostStatus}
                    </p>
                    {boostStatus.startsWith('Error') && (
                      <button
                        onClick={() => setBoostStatus(null)}
                        className="w-full bg-gray-800 hover:bg-gray-700 text-white py-2 rounded-lg font-semibold"
                      >
                        Try Again
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    <p className="text-gray-400 text-sm">
                      Move this song to{' '}
                      <span className="text-yellow-400 font-semibold">#{boostedIdx + 1}</span> in the
                      queue for{' '}
                      <span className="text-yellow-400 font-semibold">{formatPrice(boostPrice)}</span>.
                    </p>
                    {savingsMs > 0 && (
                      <p className="text-sm text-yellow-400">
                        ⏱ Boost to save {formatWaitTime(savingsMs)}
                      </p>
                    )}

                    {/* Payment method selector */}
                    {authToken && (
                      <div className="flex rounded-lg bg-gray-800 p-1 gap-1">
                        <button
                          onClick={() => {
                            setBoostPaymentMethod('credits');
                            setClientSecret(null);
                          }}
                          className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                            boostPaymentMethod === 'credits'
                              ? 'bg-green-700 text-white'
                              : 'text-gray-400 hover:text-white'
                          }`}
                        >
                          💳 Credits ({creditBalance.toFixed(1)})
                        </button>
                        <button
                          onClick={() => {
                            setBoostPaymentMethod('stripe');
                            if (!clientSecret && selectedRequestId) {
                              loadStripeIntent(selectedRequestId);
                            }
                          }}
                          className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                            boostPaymentMethod === 'stripe'
                              ? 'bg-yellow-700 text-white'
                              : 'text-gray-400 hover:text-white'
                          }`}
                        >
                          💳 Card
                        </button>
                      </div>
                    )}

                    {/* Credits payment path */}
                    {boostPaymentMethod === 'credits' && authToken ? (
                      hasEnoughCredits ? (
                        <>
                          <div className="bg-green-900/30 border border-green-700 rounded-lg px-3 py-2 text-xs text-green-200">
                            ✅ {boostPrice} credits will be deducted from your balance ({creditBalance.toFixed(2)} available).
                          </div>
                          <div className="flex gap-3">
                            <button
                              onClick={closeModal}
                              disabled={!!boostingRequestId}
                              className="flex-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-white py-2 rounded-lg font-semibold"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={confirmCreditBoost}
                              disabled={!!boostingRequestId}
                              className="flex-1 bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white py-2 rounded-lg font-semibold"
                            >
                              {boostingRequestId ? 'Boosting…' : `Use ${boostPrice} Credits`}
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="text-yellow-400 text-sm">
                            You need {boostPrice} credits to boost, but only have{' '}
                            {creditBalance.toFixed(2)}. Purchase more credits from the account menu.
                          </p>
                          <button
                            onClick={closeModal}
                            className="w-full bg-gray-800 hover:bg-gray-700 text-white py-2 rounded-lg font-semibold"
                          >
                            Close
                          </button>
                        </>
                      )
                    ) : (
                      /* Stripe payment path */
                      stripePromise ? (
                        loadingIntent ? (
                          <p className="text-gray-400 animate-pulse text-center py-4">
                            Loading payment form...
                          </p>
                        ) : clientSecret ? (
                          <Elements
                            stripe={stripePromise}
                            options={{
                              clientSecret,
                              appearance: { theme: 'night', labels: 'floating' },
                            }}
                          >
                            <div className="bg-blue-900/30 border border-blue-700 rounded-lg px-3 py-2 text-xs text-blue-200">
                              ℹ️ {REFUND_POLICY_MESSAGE}
                            </div>
                            <StripeBoostForm
                              requestId={selectedRequestId!}
                              userId={currentUserId!}
                              boostPrice={boostPrice}
                              onSuccess={() => {
                                closeModal();
                                if (onBoostSuccess) onBoostSuccess();
                              }}
                              onCancel={closeModal}
                            />
                          </Elements>
                        ) : (
                          <>
                            {boostStatus && (
                              <p className="text-red-400 text-sm">{boostStatus}</p>
                            )}
                            <button
                              onClick={() => selectedRequestId && loadStripeIntent(selectedRequestId)}
                              className="w-full bg-yellow-600 hover:bg-yellow-700 text-black py-2 rounded-lg font-semibold"
                            >
                              Load Payment Form
                            </button>
                            <button
                              onClick={closeModal}
                              className="w-full bg-gray-800 hover:bg-gray-700 text-white py-2 rounded-lg font-semibold"
                            >
                              Cancel
                            </button>
                          </>
                        )
                      ) : (
                        <div className="space-y-4">
                          {boostStatus && (
                            <p className="text-red-400 text-sm">{boostStatus}</p>
                          )}
                          <button
                            onClick={closeModal}
                            className="w-full bg-gray-800 hover:bg-gray-700 text-white py-2 rounded-lg font-semibold"
                          >
                            Close
                          </button>
                        </div>
                      )
                    )}
                  </>
                )
              ) : (
                // Free boost: simple confirmation
                !boostStatus ? (
                  <>
                    <p className="text-gray-400">
                      Boost this song to <span className="text-green-400 font-semibold">#{boostedIdx + 1}</span> in the queue for free?
                    </p>
                    <p className="text-sm text-gray-500">
                      Songs with votes and a boost jump ahead of similarly-scored songs.
                      You can only boost each song once.
                    </p>
                    {savingsMs > 0 && (
                      <p className="text-sm text-yellow-400">
                        ⏱ Boost to save {formatWaitTime(savingsMs)}
                      </p>
                    )}
                    <div className="flex gap-3">
                      <button
                        onClick={closeModal}
                        disabled={!!boostingRequestId}
                        className="flex-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-white py-2 rounded-lg font-semibold"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={confirmFreeBoost}
                        disabled={!!boostingRequestId}
                        className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white py-2 rounded-lg font-semibold"
                      >
                        {boostingRequestId ? 'Boosting...' : 'Boost +3 Spots'}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="text-center">
                    <p className={boostStatus.startsWith('Error') ? 'text-red-400' : 'text-green-400'}>
                      {boostStatus}
                    </p>
                  </div>
                )
              )}
            </div>
          </div>
        );
      })()}
    </>
  );
}
