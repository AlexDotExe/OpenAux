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

  return (
    <div className="card stack" style={{ opacity: pending ? 0.75 : 1 }}>
      <div className="row row--between">
        <div className="row">
          {rank !== undefined && <span className="pill pill--accent">#{rank}</span>}
          {isMine && <span className="pill">Your song</span>}
          {item.priorityBoostCount > 0 && (
            <span className="pill pill--warn">Boosted ×{item.priorityBoostCount}</span>
          )}
          {pending && <span className="pill">Pending approval</span>}
        </div>
      </div>
      <div>
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
  );
}
