'use client';

/**
 * Session/QR display for the venue console. Contract gap: there's no
 * documented GET /api/venues/:venueId to fetch qrToken before a session
 * exists (see lib/api.ts VenueSummary note) — we call the same assumed
 * endpoint the mock client fabricates. The QR itself is rendered from a
 * self-contained, dependency-free encoder (lib/qrcode.ts) as inline SVG, so
 * the join URL never leaves the app and no UI library is required.
 */

import { useMemo, useState } from 'react';

import { encodeQr, modulesToSvgPath } from '../../lib/qrcode';

export interface QrPanelProps {
  venueName: string;
  joinUrl: string;
  controlMode: string;
}

const QUIET_ZONE = 4;

export function QrPanel({ venueName, joinUrl, controlMode }: QrPanelProps) {
  const [copied, setCopied] = useState(false);

  const qr = useMemo(() => {
    try {
      const code = encodeQr(joinUrl);
      return {
        viewBox: code.size + QUIET_ZONE * 2,
        path: modulesToSvgPath(code.modules, QUIET_ZONE),
      };
    } catch {
      // encodeQr only throws if joinUrl is longer than QR level-M capacity;
      // fall back to the copyable link below rather than crashing the console.
      return null;
    }
  }, [joinUrl]);

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
      {qr ? (
        <svg
          role="img"
          aria-label={`QR code linking to ${joinUrl}`}
          viewBox={`0 0 ${qr.viewBox} ${qr.viewBox}`}
          shapeRendering="crispEdges"
          style={{
            width: 160,
            height: 160,
            margin: '0 auto',
            display: 'block',
            borderRadius: 8,
          }}
        >
          <rect width={qr.viewBox} height={qr.viewBox} fill="#fff" />
          <path d={qr.path} fill="#000" />
        </svg>
      ) : (
        <p className="helper-text" style={{ textAlign: 'center' }}>
          Join link is too long to render as a QR code — use the link below.
        </p>
      )}
      <p className="helper-text" style={{ wordBreak: 'break-all' }}>
        {joinUrl}
      </p>
      <button className="btn" onClick={handleCopy}>
        {copied ? 'Copied!' : 'Copy join link'}
      </button>
    </div>
  );
}
