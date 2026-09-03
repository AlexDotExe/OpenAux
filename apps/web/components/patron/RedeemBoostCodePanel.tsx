'use client';

/**
 * Patron redeems a venue-issued Boost Code for credits (SPEC.md §5 V1, decision
 * D7). Beer +1 / Cocktail +2 / Bottle +10 — the tier is decided server-side from
 * the code, so the patron just types what's on their receipt/wristband.
 */

import { useState } from 'react';

import { ApiClientError, getApiClient, type AuthContext } from '../../lib/api';

export interface RedeemBoostCodePanelProps {
  auth: AuthContext;
  onRedeemed: (creditBalance: number) => void;
}

export function RedeemBoostCodePanel({ auth, onRedeemed }: RedeemBoostCodePanelProps) {
  const [code, setCode] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const redeem = async () => {
    if (!code.trim()) {
      setError('Enter the Boost Code from your purchase.');
      return;
    }
    setRedeeming(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await getApiClient().redeemBoostCode({ code: code.trim() }, auth);
      onRedeemed(res.creditBalance);
      setFeedback(`+${res.creditsAdded} credits (${res.tier}) — ${res.creditBalance} total`);
      setCode('');
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not redeem that code.');
    } finally {
      setRedeeming(false);
    }
  };

  return (
    <div className="card stack">
      <strong>Redeem a Boost Code</strong>
      <p className="helper-text">Bought a drink? Enter the code to add credits.</p>
      <div className="row">
        <input
          type="text"
          placeholder="e.g. BEE-1A2B3"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          style={{ flex: 1 }}
        />
        <button className="btn btn-primary" onClick={redeem} disabled={redeeming}>
          {redeeming ? 'Redeeming…' : 'Redeem'}
        </button>
      </div>
      {feedback && <p className="helper-text">{feedback}</p>}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
