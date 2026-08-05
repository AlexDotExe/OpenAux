import { describe, expect, it } from 'vitest';
import { DEFAULT_V0_WEIGHTS } from '@openaux/shared';
import {
  buildPositionResponse,
  buildQueueSnapshot,
  computeBoostPreviewPositions,
  computeQueuePosition,
  estimateMinutesUntilPlay,
  shuffle,
} from './snapshot.js';
import { makeQueueItem } from './test-helpers.js';

const identityShuffle = <T>(items: T[]): T[] => items;

describe('buildQueueSnapshot', () => {
  const ranked = Array.from({ length: 6 }, (_, i) =>
    makeQueueItem({ queueItemId: `q${i}`, currentScore: 100 - i }),
  );

  it('splits into nowPlaying, top-3 upNext, and the rest', () => {
    const nowPlaying = makeQueueItem({ queueItemId: 'np', status: 'playing' });
    const snap = buildQueueSnapshot({
      nowPlaying,
      rankedQueued: ranked,
      shuffleFn: identityShuffle,
    });
    expect(snap.nowPlaying?.queueItemId).toBe('np');
    expect(snap.upNext.map((i) => i.queueItemId)).toEqual(['q0', 'q1', 'q2']);
    expect(snap.rest.map((i) => i.queueItemId)).toEqual(['q3', 'q4', 'q5']);
  });

  it('handles an empty queue', () => {
    const snap = buildQueueSnapshot({ nowPlaying: null, rankedQueued: [] });
    expect(snap).toEqual({ nowPlaying: null, upNext: [], rest: [] });
  });

  it('pre-shuffles rest via the injected shuffle', () => {
    const reverse = <T>(items: T[]): T[] => [...items].reverse();
    const snap = buildQueueSnapshot({ nowPlaying: null, rankedQueued: ranked, shuffleFn: reverse });
    expect(snap.rest.map((i) => i.queueItemId)).toEqual(['q5', 'q4', 'q3']);
  });
});

describe('shuffle', () => {
  it('is a permutation of the input (fixed rng)', () => {
    const rng = () => 0.42;
    const out = shuffle([1, 2, 3, 4, 5], rng);
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('computeQueuePosition', () => {
  const ranked = [
    makeQueueItem({ queueItemId: 'a' }),
    makeQueueItem({ queueItemId: 'b' }),
    makeQueueItem({ queueItemId: 'c' }),
  ];

  it('returns 0 for the now-playing item', () => {
    const np = makeQueueItem({ queueItemId: 'np' });
    expect(computeQueuePosition('np', ranked, np)).toBe(0);
  });

  it('returns 1-based position within the queue', () => {
    expect(computeQueuePosition('a', ranked, null)).toBe(1);
    expect(computeQueuePosition('c', ranked, null)).toBe(3);
  });

  it('returns null for an unknown item', () => {
    expect(computeQueuePosition('zzz', ranked, null)).toBeNull();
  });
});

describe('estimateMinutesUntilPlay', () => {
  it('multiplies position by average track length', () => {
    expect(estimateMinutesUntilPlay(4, 3)).toBe(12);
  });

  it('uses the default average when not provided', () => {
    expect(estimateMinutesUntilPlay(2)).toBeCloseTo(7);
  });
});

describe('computeBoostPreviewPositions', () => {
  it('reports the positions gained from one more priority boost', () => {
    const target = makeQueueItem({ queueItemId: 't', upvotesCount: 0 });
    const ahead1 = makeQueueItem({ queueItemId: 'a1', upvotesCount: 3 });
    const ahead2 = makeQueueItem({ queueItemId: 'a2', upvotesCount: 2 });
    // rank them first
    const ranked = [ahead1, ahead2, target].map((i) => ({ ...i }));
    // target base score 2; +3 boost weight lifts it above both.
    const gained = computeBoostPreviewPositions({
      target,
      rankedQueued: ranked,
      weights: DEFAULT_V0_WEIGHTS,
    });
    expect(gained).toBeGreaterThan(0);
  });

  it('returns 0 when the target is not in the queue', () => {
    const target = makeQueueItem({ queueItemId: 'missing' });
    expect(
      computeBoostPreviewPositions({ target, rankedQueued: [], weights: DEFAULT_V0_WEIGHTS }),
    ).toBe(0);
  });
});

describe('buildPositionResponse', () => {
  it('assembles position, ETA, and boost preview', () => {
    const target = makeQueueItem({ queueItemId: 't' });
    const other = makeQueueItem({ queueItemId: 'o', upvotesCount: 10 });
    const ranked = [other, target];
    const res = buildPositionResponse({
      target,
      rankedQueued: ranked,
      weights: DEFAULT_V0_WEIGHTS,
      nowPlaying: null,
      avgTrackMinutes: 3,
    });
    expect(res).not.toBeNull();
    expect(res?.position).toBe(2);
    expect(res?.estimatedMinutesUntilPlay).toBe(6);
    expect(res?.boostPreviewPositions).toBeGreaterThanOrEqual(0);
  });

  it('returns null when the item is not live', () => {
    const target = makeQueueItem({ queueItemId: 'gone' });
    expect(
      buildPositionResponse({
        target,
        rankedQueued: [],
        weights: DEFAULT_V0_WEIGHTS,
        nowPlaying: null,
      }),
    ).toBeNull();
  });
});
