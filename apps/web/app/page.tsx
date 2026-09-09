import Link from 'next/link';

export default function Home() {
  return (
    <main className="page stack">
      <div className="top-bar">
        <span className="brand">
          Open<em>Aux</em>
        </span>
        <span className="pill">Social jukebox</span>
      </div>

      <div className="stack" style={{ gap: 10, margin: '10px 0 22px' }}>
        <h1 style={{ fontSize: '2.4rem', lineHeight: 1.05 }}>
          The room picks
          <br />
          the <span style={{ color: 'var(--accent)' }}>music</span>.
        </h1>
        <p className="helper-text" style={{ fontSize: '1rem', maxWidth: '38ch' }}>
          Scan a QR code, request a song, and vote on what plays next. The crowd decides — the
          venue stays in control.
        </p>
      </div>

      {/* Patron flow lives under app/patron/ (QR join → queue).
          Venue console lives under app/venue/. See CLAUDE.md ownership map. */}
      <Link href="/patron/join" className="card card--hero stack" style={{ gap: 12 }}>
        <div className="row" style={{ gap: 14 }}>
          <div className="art art--lg art--live" aria-hidden>
            ♪
          </div>
          <div className="track-meta">
            <div style={{ fontWeight: 800, fontSize: '1.1rem' }}>I&rsquo;m at a venue</div>
            <div className="track-artist">Join the queue and start voting</div>
          </div>
        </div>
        <span className="btn btn-primary btn-block">Join a session</span>
      </Link>

      <div className="card stack">
        <div className="row" style={{ gap: 14 }}>
          <div className="art art--lg" aria-hidden>
            ▤
          </div>
          <div className="track-meta">
            <div style={{ fontWeight: 800, fontSize: '1.05rem' }}>I run a venue</div>
            <div className="track-artist">Queue control, blocks, Power Hour, payouts</div>
          </div>
        </div>
        <Link className="btn btn-ghost btn-block" href="/venue">
          Open venue console
        </Link>
      </div>

      <nav className="home-links">
        <Link className="helper-text" href="/patron/join?token=demo-qr-token">
          Try the demo join link →
        </Link>
      </nav>
    </main>
  );
}
