'use client';

import { useRef } from 'react';
import type { QueueItem, VoteDirection } from '@openaux/shared';

import { QueueItemRow } from './QueueItemRow';

export interface QueueListsProps {
  upNext: QueueItem[];
  rest: QueueItem[];
  myUserId: string | null;
  myVotes: Record<string, VoteDirection>;
  onToggleVote: (queueItemId: string, direction: VoteDirection) => void;
}

function shuffleIds(ids: string[]): string[] {
  const copy = [...ids];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = tmp;
  }
  return copy;
}

/**
 * Stable client-side shuffle of the "rest" list. The V1 two-list display shows
 * the remaining songs in a deliberately randomized order so the room doesn't
 * fixate on exact rank beyond #3. We re-shuffle only when the *set* of items
 * changes (a song added/removed/promoted), not on every vote/re-render — so the
 * list doesn't jump around while a patron is looking at it.
 */
function useShuffledRest(rest: QueueItem[]): QueueItem[] {
  const cache = useRef<{ key: string; order: string[] }>({ key: '', order: [] });
  const byId = new Map(rest.map((i) => [i.queueItemId, i]));
  const key = [...byId.keys()].sort().join('|');
  if (key !== cache.current.key) {
    cache.current = { key, order: shuffleIds(rest.map((i) => i.queueItemId)) };
  }
  return cache.current.order.map((id) => byId.get(id)).filter((i): i is QueueItem => Boolean(i));
}

/** V1 two-list display (SPEC.md §5/§6): ordered "Up Next" top 3 + a larger
 * randomized "rest" list so the room doesn't fixate on exact rank beyond #3. */
export function QueueLists({ upNext, rest, myUserId, myVotes, onToggleVote }: QueueListsProps) {
  const shuffledRest = useShuffledRest(rest);

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

      {shuffledRest.length > 0 && (
        <div>
          <div className="section-title">More in the queue</div>
          <p className="helper-text">
            Shown in random order — vote up the ones you want to reach Up Next.
          </p>
          <div className="stack">
            {shuffledRest.map((item) => (
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
