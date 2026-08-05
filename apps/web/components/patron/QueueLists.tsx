import type { QueueItem, VoteDirection } from '@openaux/shared';

import { QueueItemRow } from './QueueItemRow';

export interface QueueListsProps {
  upNext: QueueItem[];
  rest: QueueItem[];
  myUserId: string | null;
  myVotes: Record<string, VoteDirection>;
  onToggleVote: (queueItemId: string, direction: VoteDirection) => void;
}

/** V1 two-list display (SPEC.md §5/§6): ordered "Up Next" top 3 + a larger
 * randomized "rest" list so the room doesn't fixate on exact rank beyond #3. */
export function QueueLists({ upNext, rest, myUserId, myVotes, onToggleVote }: QueueListsProps) {
  return (
    <div className="stack">
      <div>
        <div className="section-title">Up Next</div>
        {upNext.length === 0 ? (
          <p className="empty-state">No songs queued yet.</p>
        ) : (
          <div className="stack">
            {upNext.map((item, i) => (
              <QueueItemRow
                key={item.queueItemId}
                item={item}
                rank={i + 1}
                myVote={myVotes[item.queueItemId] ?? null}
                isMine={item.requestingUserId === myUserId}
                onToggleVote={onToggleVote}
              />
            ))}
          </div>
        )}
      </div>

      {rest.length > 0 && (
        <div>
          <div className="section-title">More in the queue</div>
          <div className="stack">
            {rest.map((item) => (
              <QueueItemRow
                key={item.queueItemId}
                item={item}
                myVote={myVotes[item.queueItemId] ?? null}
                isMine={item.requestingUserId === myUserId}
                onToggleVote={onToggleVote}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
