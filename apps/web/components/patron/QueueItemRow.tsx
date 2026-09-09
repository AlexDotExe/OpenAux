import type { QueueItem, VoteDirection } from '@openaux/shared';

import { VoteButtons } from './VoteButtons';

export interface QueueItemRowProps {
  item: QueueItem;
  rank?: number;
  myVote: VoteDirection | null;
  isMine: boolean;
  voteDisabled?: boolean;
  onToggleVote: (queueItemId: string, direction: VoteDirection) => void;
}

export function QueueItemRow({
  item,
  rank,
  myVote,
  isMine,
  voteDisabled,
  onToggleVote,
}: QueueItemRowProps) {
  const pending = item.playabilityState === 'awaiting_approval';
  const boosted = item.priorityBoostCount > 0 || item.instantVoteCount > 0;

  return (
    <div
      className={`card stack stack--tight ${isMine ? 'card--accent' : ''}`}
      style={{ opacity: pending ? 0.7 : 1, padding: '12px 14px' }}
    >
      <div className="row" style={{ gap: 12 }}>
        {rank !== undefined && (
          <span className={`track-rank ${rank <= 3 ? 'track-rank--top' : ''}`}>{rank}</span>
        )}
        <div className="art" aria-hidden>
          ♪
        </div>
        <div className="track-meta">
          <div className="track-title">{item.title}</div>
          <div className="track-artist">{item.artist}</div>
        </div>
        <VoteButtons
          upvotesCount={item.upvotesCount}
          downvotesCount={item.downvotesCount}
          myVote={myVote}
          disabled={voteDisabled || pending}
          onToggle={(direction) => onToggleVote(item.queueItemId, direction)}
        />
      </div>
      {(isMine || boosted || pending) && (
        <div className="row row--wrap" style={{ gap: 6 }}>
          {isMine && <span className="pill pill--accent">Your song</span>}
          {item.priorityBoostCount > 0 && (
            <span className="pill pill--warn">Boosted ×{item.priorityBoostCount}</span>
          )}
          {item.instantVoteCount > 0 && <span className="pill pill--warn">Instant Play</span>}
          {pending && <span className="pill">Pending approval</span>}
        </div>
      )}
    </div>
  );
}
