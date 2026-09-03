import { describe, expect, it } from 'vitest';
import {
  computeGroupArrivalSpamSignal,
  DEFAULT_GROUP_ABUSE_CONFIG,
  detectArrivalClusters,
  flagClusteredUserIds,
  type JoinArrival,
} from './group-abuse.js';

const base = new Date('2026-09-03T22:00:00.000Z').getTime();
/** Build an arrival `seconds` after the base instant. */
const at = (userId: string, seconds: number): JoinArrival => ({
  userId,
  joinedAt: new Date(base + seconds * 1000),
});

describe('detectArrivalClusters', () => {
  it('returns no clusters when arrivals are spread out', () => {
    const arrivals = [at('a', 0), at('b', 120), at('c', 240), at('d', 360), at('e', 480)];
    expect(detectArrivalClusters(arrivals)).toEqual([]);
  });

  it('flags a burst of >= minClusterSize joins within the window', () => {
    const arrivals = [at('a', 0), at('b', 5), at('c', 10), at('d', 15), at('e', 20)];
    const clusters = detectArrivalClusters(arrivals);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.size).toBe(5);
    expect(clusters[0]?.userIds).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('does not flag a cluster of size just below the threshold', () => {
    const arrivals = [at('a', 0), at('b', 5), at('c', 10), at('d', 15)];
    expect(detectArrivalClusters(arrivals)).toEqual([]);
  });

  it('anchors the window at the first arrival so a slow trickle does not chain', () => {
    // 7 arrivals 15s apart: each consecutive gap is small, but the span from the
    // first exceeds the 60s window, so they split into windows and none reaches 5.
    const arrivals = [
      at('a', 0),
      at('b', 15),
      at('c', 30),
      at('d', 45),
      at('e', 60),
      at('f', 75),
      at('g', 90),
    ];
    // First cluster spans 0..60 (a..e = 5) → flagged; remainder f,g too small.
    const clusters = detectArrivalClusters(arrivals);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.userIds).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('sorts unordered input before clustering', () => {
    const arrivals = [at('c', 10), at('a', 0), at('e', 20), at('b', 5), at('d', 15)];
    const clusters = detectArrivalClusters(arrivals);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.userIds).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('detects two separate bursts', () => {
    const arrivals = [
      at('a', 0),
      at('b', 2),
      at('c', 4),
      at('d', 6),
      at('e', 8),
      // gap > window
      at('f', 600),
      at('g', 602),
      at('h', 604),
      at('i', 606),
      at('j', 608),
    ];
    expect(detectArrivalClusters(arrivals)).toHaveLength(2);
  });

  it('respects custom config', () => {
    const arrivals = [at('a', 0), at('b', 1), at('c', 2)];
    expect(
      detectArrivalClusters(arrivals, { ...DEFAULT_GROUP_ABUSE_CONFIG, minClusterSize: 3 }),
    ).toHaveLength(1);
  });
});

describe('flagClusteredUserIds', () => {
  it('returns the union of user ids across suspicious clusters', () => {
    const arrivals = [at('a', 0), at('b', 5), at('c', 10), at('d', 15), at('e', 20)];
    expect(flagClusteredUserIds(arrivals)).toEqual(new Set(['a', 'b', 'c', 'd', 'e']));
  });

  it('is empty when nothing is suspicious', () => {
    expect(flagClusteredUserIds([at('a', 0), at('b', 300)])).toEqual(new Set());
  });
});

describe('computeGroupArrivalSpamSignal', () => {
  it('is 0 for supporters without a coordinated cluster', () => {
    expect(computeGroupArrivalSpamSignal([at('a', 0), at('b', 300)])).toBe(0);
  });

  it('adds one signal per suspicious cluster', () => {
    const arrivals = [at('a', 0), at('b', 5), at('c', 10), at('d', 15), at('e', 20)];
    expect(computeGroupArrivalSpamSignal(arrivals)).toBe(1);
  });

  it('scales with spamSignalPerCluster', () => {
    const arrivals = [at('a', 0), at('b', 5), at('c', 10), at('d', 15), at('e', 20)];
    expect(
      computeGroupArrivalSpamSignal(arrivals, {
        ...DEFAULT_GROUP_ABUSE_CONFIG,
        spamSignalPerCluster: 3,
      }),
    ).toBe(3);
  });
});
