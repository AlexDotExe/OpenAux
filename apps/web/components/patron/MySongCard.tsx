'use client';

/**
 * Monetization-moment card (SPEC.md §5/§6): "Your song: #6 in queue", ETA,
 * minutes saved if boosted, and the paid CTAs — "Boost to #N for $1" (Priority
 * Boost) and "Instant Play Vote for $3". Fetches GET /api/queue-items/:id/position
 * whenever the item or `refreshToken` changes (queue_updated events bump the
 * token so this stays live without polling).
 */

import { useEffect, useState } from 'react';
import type { PurchaseBoostRequest, QueueItem } from '@openaux/shared';

import { ApiClientError, getApiClient, type AuthContext } from '../../lib/api';
import { formatEta } from '../../lib/format';

/** Same rough per-song estimate the queue ETA uses, for "minutes saved if boosted". */
const AVG_SONG_MINUTES = 3.5;

export interface MySongCardProps {
  item: QueueItem;
  auth: AuthContext;
  refreshToken: number;
  onBoosted: (creditBalance: number) => void;
}

export function MySongCard({ item, auth, refreshToken, onBoosted }: MySongCardProps) {
  const [position, setPosition] = useState<number | null>(null);
  const [etaMinutes, setEtaMinutes] = useState<number | null>(null);
  const [boostPreview, setBoostPreview] = useState<number>(0);
  const [pending, setPending] = useState<PurchaseBoostRequest['boostType'] | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getApiClient()
      .getPosition(item.queueItemId, auth)
      .then((res) => {
        if (cancelled) return;
        setPosition(res.position);
        setEtaMinutes(res.estimatedMinutesUntilPlay);
        setBoostPreview(res.boostPreviewPositions);
      })
      .catch(() => {
        /* position is a nice-to-have; ignore transient failures */
      });
    return () => {
      cancelled = true;
    };
  }, [item.queueItemId, item.currentScore, refreshToken, auth.sessionId]);

  const purchase = async (boostType: PurchaseBoostRequest['boostType']) => {
    setPending(boostType);
    setError(null);
    setFeedback(null);
    try {
      const res = await getApiClient().purchaseBoost(item.queueItemId, { boostType }, auth);
      onBoosted(res.creditBalance);
      const label = boostType === 'instant_play_vote' ? 'Instant Play Vote' : 'Priority Boost';
      setFeedback(
        `${label} applied — +${res.paidPointsAdded} vote points · ${res.creditBalance} credit${
          res.creditBalance === 1 ? '' : 's'
        } left`,
      );
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Purchase failed — try again.');
    } finally {
      setPending(null);
    }
  };

  if (item.status === 'playing') {
    return (
      <div className="card card--raised">
        <p>
          <strong>Your song is playing now</strong> — {item.title}
        </p>
      </div>
    );
  }

  const targetPosition = position !== null ? Math.max(1, position - boostPreview) : null;
  const minutesSaved = Math.round(boostPreview * AVG_SONG_MINUTES);
  const canBoostToPosition =
    boostPreview > 0 && targetPosition !== null && position !== null && targetPosition < position;

  return (
    <div className="card card--raised stack">
      <div>
        <strong>Your song: {item.title}</strong>
        <p className="helper-text">
          {position !== null ? `#${position} in queue` : 'Calculating position…'}
          {etaMinutes !== null ? ` · ETA ${formatEta(etaMinutes)}` : ''}
          {canBoostToPosition && minutesSaved > 0 ? ` · save ~${minutesSaved} min if boosted` : ''}
        </p>
      </div>
      {canBoostToPosition && (
        <button
          className="btn btn-primary btn-block"
          onClick={() => purchase('priority_boost')}
          disabled={pending !== null}
        >
          {pending === 'priority_boost' ? 'Boosting…' : `Boost to #${targetPosition} for $1`}
        </button>
      )}
      <button
        className="btn btn-block"
        onClick={() => purchase('instant_play_vote')}
        disabled={pending !== null}
      >
        {pending === 'instant_play_vote' ? 'Purchasing…' : 'Instant Play Vote for $3'}
      </button>
      <p className="helper-text">
        An Instant Play Vote counts like ~10 votes instantly, but stays capped so the crowd can
        still override it.
      </p>
      {feedback && <p className="helper-text">{feedback}</p>}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
