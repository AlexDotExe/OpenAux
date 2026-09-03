'use client';

/**
 * Boost Code generation (SPEC.md §5 V1, decision D7): the venue picks a purchase
 * tier (Beer +1 / Cocktail +2 / Bottle +10 — credit value fixed by the tier),
 * generates a single-use code to hand to the patron, and sees the code + its
 * 30-min expiry countdown. Issued codes are listed via GET /boost-codes.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  BOOST_CODE_TIER_CREDITS,
  type BoostCodePublic,
  type BoostCodeTier,
} from '@openaux/shared';

import { ApiClientError, getApiClient, type AuthContext } from '../../lib/api';

const TIERS: BoostCodeTier[] = ['beer', 'cocktail', 'bottle'];

export interface BoostCodePanelProps {
  venueId: string;
  auth: AuthContext;
}

function codeStatus(code: BoostCodePublic, now: number): string {
  if (code.redeemedBy) return 'Redeemed';
  const remaining = Date.parse(code.expiresAt) - now;
  if (remaining <= 0) return 'Expired';
  const totalSeconds = Math.floor(remaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `Expires in ${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function BoostCodePanel({ venueId, auth }: BoostCodePanelProps) {
  const [tier, setTier] = useState<BoostCodeTier>('beer');
  const [codes, setCodes] = useState<BoostCodePublic[]>([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(() => {
    getApiClient()
      .listBoostCodes(venueId, auth)
      .then((res) => setCodes(res.boostCodes))
      .catch(() => {
        /* listing is best-effort; a fresh venue simply has none yet */
      });
  }, [venueId, auth]);

  useEffect(() => {
    load();
  }, [load]);

  // Tick so the expiry countdowns stay live.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await getApiClient().generateBoostCode(venueId, { tier }, auth);
      setCodes((prev) => [res.boostCode, ...prev]);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not generate a code.');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="card stack">
      <strong>Boost Codes</strong>
      <p className="helper-text">
        Generate a single-use code for a qualifying purchase. Codes expire 30 min after issue.
      </p>

      <div className="tab-row">
        {TIERS.map((t) => (
          <button
            key={t}
            className={`btn btn-sm${t === tier ? ' is-active' : ''}`}
            onClick={() => setTier(t)}
          >
            {t[0]!.toUpperCase() + t.slice(1)} +{BOOST_CODE_TIER_CREDITS[t]}
          </button>
        ))}
      </div>

      <button className="btn btn-primary" onClick={generate} disabled={generating}>
        {generating ? 'Generating…' : `Generate ${tier} code (+${BOOST_CODE_TIER_CREDITS[tier]})`}
      </button>
      {error && <p className="error-text">{error}</p>}

      {codes.length > 0 ? (
        <div className="stack">
          {codes.map((c) => (
            <div key={c.boostCodeId} className="row row--between">
              <div>
                <div className="track-title">{c.code}</div>
                <div className="track-artist">
                  {c.tier} · +{c.creditValue} credits
                </div>
              </div>
              <span className="pill">{codeStatus(c, now)}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="empty-state">No codes issued yet.</p>
      )}
    </div>
  );
}
