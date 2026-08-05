'use client';

/**
 * Session/QR display for the venue console. Contract gap: there's no
 * documented GET /api/venues/:venueId to fetch qrToken before a session
 * exists (see lib/api.ts VenueSummary note) — we call the same assumed
 * endpoint the mock client fabricates. Also no real QR image library is
 * wired up (scope says "no UI library dependencies"); this renders the join
 * URL as copyable text plus a placeholder QR box — swap in a proper QR
 * renderer (e.g. the `qrcode` package) before shipping.
 */

import { useState } from 'react';

export interface QrPanelProps {
  venueName: string;
  joinUrl: string;
  controlMode: string;
}

export function QrPanel({ venueName, joinUrl, controlMode }: QrPanelProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API may be unavailable (non-HTTPS/local); the URL is still shown below.
    }
  };

  return (
    <div className="card stack">
      <div className="row row--between">
        <strong>{venueName}</strong>
        <span className="pill">
          {controlMode === 'crowd' ? 'Crowd control' : 'Suggestion mode'}
        </span>
      </div>
      <div
        aria-hidden
        style={{
          width: 160,
          height: 160,
          margin: '0 auto',
          background: 'repeating-conic-gradient(#000 0% 25%, #fff 0% 50%)',
          backgroundSize: '20px 20px',
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          textShadow: '0 0 4px #000',
          fontSize: 12,
        }}
      >
        QR placeholder
      </div>
      <p className="helper-text" style={{ wordBreak: 'break-all' }}>
        {joinUrl}
      </p>
      <button className="btn" onClick={handleCopy}>
        {copied ? 'Copied!' : 'Copy join link'}
      </button>
    </div>
  );
}
