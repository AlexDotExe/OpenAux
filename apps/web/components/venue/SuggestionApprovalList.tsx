'use client';

import { useState } from 'react';
import type { QueueItem } from '@openaux/shared';

import { ApiClientError, getApiClient, type AuthContext } from '../../lib/api';

export interface SuggestionApprovalListProps {
  venueId: string;
  auth: AuthContext;
  items: QueueItem[];
}

export function SuggestionApprovalList({ venueId, auth, items }: SuggestionApprovalListProps) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decide = async (queueItemId: string, decision: 'approve' | 'reject') => {
    setPendingId(queueItemId);
    setError(null);
    try {
      await getApiClient().decideApproval(venueId, queueItemId, { decision }, auth);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not record decision.');
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div className="card stack">
      <strong>Suggestion approvals</strong>
      {items.length === 0 ? (
        <p className="helper-text">No requests waiting on approval.</p>
      ) : (
        items.map((item) => (
          <div className="track-row" key={item.queueItemId}>
            <div className="track-meta">
              <div className="track-title">{item.title}</div>
              <div className="track-artist">{item.artist}</div>
            </div>
            <div className="row">
              <button
                className="btn btn-sm btn-primary"
                onClick={() => decide(item.queueItemId, 'approve')}
                disabled={pendingId === item.queueItemId}
              >
                Approve
              </button>
              <button
                className="btn btn-sm btn-danger"
                onClick={() => decide(item.queueItemId, 'reject')}
                disabled={pendingId === item.queueItemId}
              >
                Reject
              </button>
            </div>
          </div>
        ))
      )}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
