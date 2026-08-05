import { describe, expect, it } from 'vitest';
import {
  isPlayable,
  passesArtistConstraint,
  selectNextTrack,
  type PlayabilityContext,
  type SelectNextInput,
} from './dj-brain.js';
import { makeQueueItem } from './test-helpers.js';

const crowd: PlayabilityContext = { controlMode: 'crowd' };
const suggestion: PlayabilityContext = { controlMode: 'suggestion' };

describe('isPlayable', () => {
  it('is true for a queued, playable item', () => {
    expect(isPlayable(makeQueueItem(), crowd)).toBe(true);
  });

  it('is false for a non-queued item', () => {
    expect(isPlayable(makeQueueItem({ status: 'played' }), crowd)).toBe(false);
  });

  it('is false for an item awaiting approval (suggestion mode)', () => {
    const item = makeQueueItem({ playabilityState: 'awaiting_approval' });
    expect(isPlayable(item, suggestion)).toBe(false);
  });

  it('is false for a held item', () => {
    expect(isPlayable(makeQueueItem({ playabilityState: 'held' }), crowd)).toBe(false);
  });
});

describe('passesArtistConstraint', () => {
  it('passes when the artist is not recent', () => {
    const item = makeQueueItem({ artist: 'Drake' });
    expect(passesArtistConstraint(item, ['Adele', 'Sia'])).toBe(true);
  });

  it('fails when the artist is within the last 3 played (case-insensitive)', () => {
    const item = makeQueueItem({ artist: 'Drake' });
    expect(passesArtistConstraint(item, ['drake', 'Sia'])).toBe(false);
  });

  it('ignores artists beyond the window of 3', () => {
    const item = makeQueueItem({ artist: 'Drake' });
    expect(passesArtistConstraint(item, ['A', 'B', 'C', 'Drake'])).toBe(true);
  });
});

function selectInput(over: Partial<SelectNextInput> = {}): SelectNextInput {
  return {
    rankedItems: [],
    recentArtists: [],
    context: crowd,
    fallbackPlaylist: [],
    fallbackCursor: 0,
    ...over,
  };
}

describe('selectNextTrack', () => {
  it('picks the highest-ranked playable item that clears the vibe constraint', () => {
    const top = makeQueueItem({ queueItemId: 'top', artist: 'Drake' });
    const second = makeQueueItem({ queueItemId: 'second', artist: 'Adele' });
    const result = selectNextTrack(
      selectInput({ rankedItems: [top, second], recentArtists: ['Drake'] }),
    );
    expect(result).toEqual({
      kind: 'queue_item',
      item: second,
      artistConstraintRelaxed: false,
      forced: false,
    });
  });

  it('skips non-playable items to reach a playable one', () => {
    const held = makeQueueItem({ queueItemId: 'held', playabilityState: 'held' });
    const ok = makeQueueItem({ queueItemId: 'ok', artist: 'Sia' });
    const result = selectNextTrack(selectInput({ rankedItems: [held, ok] }));
    expect(result).toMatchObject({ kind: 'queue_item', item: ok });
  });

  it('relaxes the artist constraint rather than going silent when all repeat', () => {
    const only = makeQueueItem({ queueItemId: 'only', artist: 'Drake' });
    const result = selectNextTrack(selectInput({ rankedItems: [only], recentArtists: ['Drake'] }));
    expect(result).toEqual({
      kind: 'queue_item',
      item: only,
      artistConstraintRelaxed: true,
      forced: false,
    });
  });

  it('picks the forced item over a higher-ranked one and bypasses the vibe constraint', () => {
    const top = makeQueueItem({ queueItemId: 'top', artist: 'Adele', currentScore: 100 });
    const forced = makeQueueItem({ queueItemId: 'forced', artist: 'Drake', currentScore: 1 });
    const result = selectNextTrack(
      selectInput({
        rankedItems: [top, forced],
        recentArtists: ['Drake'], // would normally fail forced's vibe constraint
        forcedItemId: 'forced',
      }),
    );
    expect(result).toEqual({
      kind: 'queue_item',
      item: forced,
      artistConstraintRelaxed: false,
      forced: true,
    });
  });

  it('falls through to normal selection when the forced item is no longer playable', () => {
    const top = makeQueueItem({ queueItemId: 'top', artist: 'Adele' });
    const held = makeQueueItem({ queueItemId: 'held', playabilityState: 'held' });
    const result = selectNextTrack(selectInput({ rankedItems: [held, top], forcedItemId: 'held' }));
    expect(result).toEqual({
      kind: 'queue_item',
      item: top,
      artistConstraintRelaxed: false,
      forced: false,
    });
  });

  it('falls through to normal selection when the forced item is no longer in the ranked list', () => {
    const top = makeQueueItem({ queueItemId: 'top', artist: 'Adele' });
    const result = selectNextTrack(selectInput({ rankedItems: [top], forcedItemId: 'gone' }));
    expect(result).toEqual({
      kind: 'queue_item',
      item: top,
      artistConstraintRelaxed: false,
      forced: false,
    });
  });

  it('falls back to the venue playlist when no item is playable', () => {
    const held = makeQueueItem({ playabilityState: 'held' });
    const result = selectNextTrack(
      selectInput({ rankedItems: [held], fallbackPlaylist: ['fb-a', 'fb-b'], fallbackCursor: 0 }),
    );
    expect(result).toEqual({ kind: 'fallback', providerTrackId: 'fb-a', cursor: 0 });
  });

  it('rotates the fallback playlist by cursor', () => {
    const result = selectNextTrack(
      selectInput({ fallbackPlaylist: ['fb-a', 'fb-b', 'fb-c'], fallbackCursor: 4 }),
    );
    expect(result).toEqual({ kind: 'fallback', providerTrackId: 'fb-b', cursor: 1 });
  });

  it('reports silence only when queue and fallback are both empty', () => {
    expect(selectNextTrack(selectInput())).toEqual({ kind: 'silent' });
  });
});
