import Link from 'next/link';

export default function Home() {
  return (
    <main className="page stack">
      <h1>OpenAux</h1>
      <p className="helper-text">Music to the people.</p>
      {/* Patron flow lives under app/patron/ (QR join → queue).
          Venue console lives under app/venue/. See CLAUDE.md ownership map. */}
      <div className="card stack">
        <div>
          <strong>Patron</strong>
          <p className="helper-text">Scan a venue QR code, or open the join link directly.</p>
        </div>
        <Link className="btn btn-primary" href="/patron/join?token=demo-qr-token">
          Try the demo join link
        </Link>
      </div>
      <div className="card stack">
        <div>
          <strong>Venue console</strong>
          <p className="helper-text">Session control, blocks, overrides, anthem setup.</p>
        </div>
        <Link className="btn" href="/venue">
          Open venue console
        </Link>
      </div>
    </main>
  );
}
