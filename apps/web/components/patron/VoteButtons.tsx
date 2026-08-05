'use client';

import type { VoteDirection } from '@openaux/shared';

export interface VoteButtonsProps {
  upvotesCount: number;
  downvotesCount: number;
  myVote: VoteDirection | null;
  disabled?: boolean;
  onToggle: (direction: VoteDirection) => void;
}

/** Up/down vote control. Optimistic-update logic lives in the caller —
 * this component only renders current state and reports taps. */
export function VoteButtons({
  upvotesCount,
  downvotesCount,
  myVote,
  disabled,
  onToggle,
}: VoteButtonsProps) {
  return (
    <div className="row">
      <button
        type="button"
        className={`vote-btn vote-btn--up${myVote === 'up' ? ' is-active' : ''}`}
        onClick={() => onToggle('up')}
        disabled={disabled}
        aria-pressed={myVote === 'up'}
        aria-label="Upvote"
      >
        ▲ {upvotesCount}
      </button>
      <button
        type="button"
        className={`vote-btn vote-btn--down${myVote === 'down' ? ' is-active' : ''}`}
        onClick={() => onToggle('down')}
        disabled={disabled}
        aria-pressed={myVote === 'down'}
        aria-label="Downvote"
      >
        ▼ {downvotesCount}
      </button>
    </div>
  );
}
