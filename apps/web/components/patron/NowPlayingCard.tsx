import type { ExternalNowPlaying, QueueItem } from '@openaux/shared';

export interface NowPlayingCardProps {
  queueItem: QueueItem | null;
  /**
   * Audio playing that isn't a crowd pick — the venue's fallback playlist or the
   * provider's own autoplay. Shown when `queueItem` is null so the card never
   * claims silence over real music (issue #98).
   */
  external?: ExternalNowPlaying | null;
  djAttribution: string | null;
  /** Running crowd-skip tally for this song (from the realtime channel / snapshot). */
  crowdSkipVotes?: number;
  /** Votes needed to skip, when known (from CrowdSkipVoteUpdateEvent). */
  crowdSkipThreshold?: number | null;
  /** Cast a crowd-skip vote for the now-playing song. Omitted when voting isn't available. */
  onSkipVote?: () => void;
  skipVoting?: boolean;
  skipVoted?: boolean;
  skipVoteError?: string | null;
}

export function NowPlayingCard({
  queueItem,
  external = null,
  djAttribution,
  crowdSkipVotes = 0,
  crowdSkipThreshold = null,
  onSkipVote,
  skipVoting = false,
  skipVoted = false,
  skipVoteError = null,
}: NowPlayingCardProps) {
  return (
    <div className={`card stack ${queueItem || external ? 'card--hero' : 'card--raised'}`}>
      <div className="row row--between">
        <span className="row" style={{ gap: 8 }}>
          <span className="pill pill--accent">Now Playing</span>
          {(queueItem || external) && (
            <span className="eq" aria-hidden>
              <span />
              <span />
              <span />
            </span>
          )}
        </span>
        {queueItem?.sourceType === 'override' && <span className="pill">Venue pick</span>}
        {queueItem?.sourceType === 'venue' && <span className="pill">Fallback playlist</span>}
        {!queueItem && external && (
          <span className="pill">
            {external.source === 'venue_playlist' ? 'Venue playlist' : 'Not from the queue'}
          </span>
        )}
      </div>
      {queueItem ? (
        <>
          <div className="row" style={{ gap: 14 }}>
            <div className="art art--lg art--live" aria-hidden>
              ♪
            </div>
            <div className="track-meta">
              <div className="track-title" style={{ fontSize: '1.2rem', fontWeight: 800 }}>
                {queueItem.title}
              </div>
              <div className="track-artist">{queueItem.artist}</div>
            </div>
          </div>
          {djAttribution && (
            <p className="helper-text">
              <span style={{ color: 'var(--accent-strong)', fontWeight: 700 }}>
                DJ {djAttribution}
              </span>{' '}
              is playing this one
            </p>
          )}
          {onSkipVote && (
            <div className="row row--between">
              <span className="helper-text">
                {crowdSkipVotes > 0 || crowdSkipThreshold !== null
                  ? `Crowd skip: ${crowdSkipVotes}${
                      crowdSkipThreshold !== null ? ` / ${crowdSkipThreshold}` : ''
                    }`
                  : 'Not feeling it?'}
              </span>
              <button
                className="btn btn-sm"
                onClick={onSkipVote}
                disabled={skipVoting || skipVoted}
              >
                {skipVoted ? 'Skip voted' : skipVoting ? 'Voting…' : 'Vote to skip'}
              </button>
            </div>
          )}
          {skipVoteError && <p className="error-text">{skipVoteError}</p>}
        </>
      ) : external ? (
        <>
          <div className="row" style={{ gap: 14 }}>
            <div className="art art--lg" aria-hidden>
              ♪
            </div>
            <div className="track-meta">
              <div className="track-title" style={{ fontSize: '1.15rem', fontWeight: 800 }}>
                {external.track.title}
              </div>
              <div className="track-artist">{external.track.artist}</div>
            </div>
          </div>
          <p className="helper-text">
            {external.source === 'venue_playlist'
              ? 'From the venue’s playlist — request a song to take over the queue.'
              : 'Not from the queue — request a song and the crowd takes over.'}
          </p>
        </>
      ) : (
        <p className="empty-state">Nothing playing yet — request a song to get things started.</p>
      )}
    </div>
  );
}
