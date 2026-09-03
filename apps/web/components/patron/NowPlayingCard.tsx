import type { QueueItem } from '@openaux/shared';

export interface NowPlayingCardProps {
  queueItem: QueueItem | null;
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
  djAttribution,
  crowdSkipVotes = 0,
  crowdSkipThreshold = null,
  onSkipVote,
  skipVoting = false,
  skipVoted = false,
  skipVoteError = null,
}: NowPlayingCardProps) {
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
      ) : (
        <p className="empty-state">Nothing playing yet — request a song to get things started.</p>
      )}
    </div>
  );
}
