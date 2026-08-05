import type { QueueItem } from '@openaux/shared';

export interface NowPlayingCardProps {
  queueItem: QueueItem | null;
  djAttribution: string | null;
}

export function NowPlayingCard({ queueItem, djAttribution }: NowPlayingCardProps) {
  return (
    <div className="card card--raised stack">
      <div className="row row--between">
        <span className="pill pill--accent">Now Playing</span>
        {queueItem?.sourceType === 'override' && <span className="pill">Venue pick</span>}
        {queueItem?.sourceType === 'venue' && <span className="pill">Fallback playlist</span>}
      </div>
      {queueItem ? (
        <>
          <div>
            <div className="track-title" style={{ fontSize: '1.1rem' }}>
              {queueItem.title}
            </div>
            <div className="track-artist">{queueItem.artist}</div>
          </div>
          {djAttribution && <p className="helper-text">DJ {djAttribution} is playing this one</p>}
        </>
      ) : (
        <p className="empty-state">Nothing playing yet — request a song to get things started.</p>
      )}
    </div>
  );
}
