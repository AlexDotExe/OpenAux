'use client';

import { useState } from 'react';
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

interface Song {
  requestId: string;
  songId: string;
  title: string;
  artist: string;
  score: number;
  voteCount: number;
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
  onBoostSuccess?: () => void;
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

    // Confirm the payment using the client secret already loaded into <Elements>
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

    // Tell the server to confirm the boost
    const res = await fetch(`/api/requests/${requestId}/boost`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, stripePaymentIntentId: paymentIntent.id }),
    });

    const data = await res.json();

    if (res.ok) {
      setStatus('✅ Song boosted to the top!');
      setTimeout(() => {
        onSuccess();
      }, 1500);
    } else {
      setStatus(`Error: ${data.error}`);
      setProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement />
      {status && (
        <p className={status.startsWith('✅') ? 'text-green-400 text-sm' : 'text-red-400 text-sm'}>
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
          {processing ? 'Processing…' : `Pay $${boostPrice.toFixed(2)}`}
        </button>
      </div>
    </form>
  );
}

export function SongQueue({ queue, onVote, currentUserId, boostPrice = 5.0, monetizationEnabled = false, onBoostSuccess }: Props) {
  const { queue: storeQueue } = useSessionStore();
  const displayQueue = queue.length > 0 ? queue : storeQueue;
  const [boostingRequestId, setBoostingRequestId] = useState<string | null>(null);
  const [showBoostModal, setShowBoostModal] = useState(false);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [boostStatus, setBoostStatus] = useState<string | null>(null);
  // Stripe payment intent client secret (only for paid boosts)
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loadingIntent, setLoadingIntent] = useState(false);

  const handleBoostClick = async (requestId: string) => {
    setSelectedRequestId(requestId);
    setBoostStatus(null);
    setClientSecret(null);

    if (boostPrice > 0 && stripePromise) {
      // Paid boost: create a payment intent first
      setLoadingIntent(true);
      setShowBoostModal(true);

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
    } else {
      // Free boost: show simple confirmation
      setShowBoostModal(true);
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
        setBoostStatus('Success! Your song has been boosted to the top!');
        setTimeout(() => {
          setShowBoostModal(false);
          setBoostStatus(null);
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
  };

  if (displayQueue.length === 0) {
    return (
      <div className="bg-gray-900 rounded-xl p-4 text-center">
        <p className="text-gray-400">No songs in the queue yet.</p>
        <p className="text-gray-500 text-sm mt-1">Be the first to request one!</p>
      </div>
    );
  }

  const canBoost = (song: Song) => {
    // Show boost button if user owns the song and it's not already boosted
    // Even show it when price is 0 (free) - button will show "FREE Boost"
    const result = (
      currentUserId &&
      song.userId === currentUserId &&
      !song.isBoosted
    );

    // Debug logging
    if (currentUserId && song.userId === currentUserId) {
      console.log('[SongQueue] Boost check for song:', {
        songTitle: song.title,
        monetizationEnabled,
        currentUserId,
        songUserId: song.userId,
        isBoosted: song.isBoosted,
        canBoost: result,
        boostPrice
      });
    }

    return result;
  };

  const isUserSong = (song: Song) => {
    return currentUserId && song.userId === currentUserId;
  };

  return (
    <>
      <div className="space-y-3">
        <h2 className="font-semibold">🎵 Song Queue</h2>
        {displayQueue.map((song, idx) => (
          <div key={song.requestId} className="space-y-2">
            {/* Queue Position Indicator - Only show for user's songs */}
            {isUserSong(song) && idx > 0 && (
              <div className="bg-blue-900/20 border border-blue-700 rounded-lg p-3">
                <p className="text-sm text-blue-300 text-center">
                  📍 {idx === 1 ? 'Next up!' : `${idx} ${idx === 1 ? 'song' : 'songs'} ahead of yours`}
                </p>
              </div>
            )}

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
                {/* Position */}
                <span className="text-gray-600 font-mono text-sm w-5 shrink-0">
                  {song.isBoosted && '⚡'}
                  {idx === 0 ? '▶' : `${idx + 1}`}
                </span>

                {/* Song info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium truncate">{song.title}</p>
                    {song.isBoosted && (
                      <span className="text-xs bg-yellow-600 text-black px-2 py-0.5 rounded-full font-semibold shrink-0">
                        BOOSTED
                      </span>
                    )}
                  </div>
                  <p className="text-gray-400 text-sm truncate">{song.artist}</p>
                </div>

                {/* Vote buttons */}
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

                {/* Score */}
                <div className="text-xs text-gray-500 shrink-0">{song.score.toFixed(1)}</div>
              </div>

              {/* Bottom row: Boost button (full width) */}
              {canBoost(song) && (
                <button
                  onClick={() => handleBoostClick(song.requestId)}
                  disabled={!!boostingRequestId}
                  className={`w-full text-sm font-semibold py-2 rounded-lg transition-colors ${
                    boostPrice === 0
                      ? 'bg-green-600 hover:bg-green-700 text-white'
                      : 'bg-yellow-600 hover:bg-yellow-700 text-black'
                  } disabled:opacity-40`}
                >
                  ⚡ {boostPrice === 0 ? 'Boost to Top' : `Boost to Top - $${boostPrice.toFixed(2)}`}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Boost Modal */}
      {showBoostModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
          <div className="bg-gray-900 rounded-xl p-6 max-w-sm w-full space-y-4">
            <h3 className="text-xl font-bold">⚡ Boost Your Song</h3>

            {/* Paid boost: Stripe payment form */}
            {boostPrice > 0 && stripePromise ? (
              loadingIntent ? (
                <p className="text-gray-400 animate-pulse text-center py-4">Loading payment form…</p>
              ) : clientSecret ? (
                <Elements
                  stripe={stripePromise}
                  options={{
                    clientSecret,
                    appearance: { theme: 'night', labels: 'floating' },
                  }}
                >
                  <p className="text-gray-400 text-sm">
                    Boost this song to the top of the queue for{' '}
                    <span className="text-yellow-400 font-semibold">${boostPrice.toFixed(2)}</span>.
                  </p>
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
                // Error loading intent
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
            ) : (
              // Free boost: simple confirmation
              !boostStatus ? (
                <>
                  <p className="text-gray-400">
                    Boost this song to the top of the queue for free?
                  </p>
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
                      {boostingRequestId ? 'Boosting...' : 'Boost to Top'}
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
      )}
    </>
  );
}
