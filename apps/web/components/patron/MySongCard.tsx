'use client';

/**
 * Monetization-moment card (SPEC.md §5/§6): "Your song: #6 in queue", ETA,
 * and "Boost to #N for $1" CTA. Fetches GET /api/queue-items/:id/position
 * whenever the item or `refreshToken` changes (queue_updated events bump the
 * token so this stays live without polling).
 */

import { useEffect, useState } from 'react';
import type { QueueItem } from '@openaux/shared';

import { ApiClientError, getApiClient, type AuthContext } from '../../lib/api';
import { formatEta } from '../../lib/format';

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
  const [boosting, setBoosting] = useState(false);
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

  const handleBoost = async () => {
    setBoosting(true);
    setError(null);
    try {
      const res = await getApiClient().purchaseBoost(
        item.queueItemId,
        { boostType: 'priority_boost' },
        auth,
      );
      onBoosted(res.creditBalance);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Boost failed — try again.');
    } finally {
      setBoosting(false);
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

  return (
    <div className="card card--raised stack">
      <div>
        <strong>Your song: {item.title}</strong>
        <p className="helper-text">
          {position !== null ? `#${position} in queue` : 'Calculating position…'}
          {etaMinutes !== null ? ` · ETA ${formatEta(etaMinutes)}` : ''}
        </p>
      </div>
      {boostPreview > 0 &&
        targetPosition !== null &&
        position !== null &&
        targetPosition < position && (
          <button className="btn btn-primary btn-block" onClick={handleBoost} disabled={boosting}>
            {boosting ? 'Boosting…' : `Boost to #${targetPosition} for $1`}
          </button>
        )}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
