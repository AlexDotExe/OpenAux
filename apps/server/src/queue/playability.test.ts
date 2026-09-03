import { describe, expect, it } from 'vitest';
import {
  hasDemandOverride,
  isMinVoteGateActive,
  isPlayableV1,
  meetsMinVoteGate,
  passesPlayabilityGate,
} from './playability.js';
import { makeQueueItem } from './test-helpers.js';

describe('isMinVoteGateActive', () => {
  it('is off below 10 active users, on at/above 10 (SPEC.md D3)', () => {
    expect(isMinVoteGateActive(9)).toBe(false);
    expect(isMinVoteGateActive(10)).toBe(true);
    expect(isMinVoteGateActive(50)).toBe(true);
  });
});

describe('meetsMinVoteGate', () => {
  it('requires up ≥ 6 AND up/(up+down) ≥ 0.60', () => {
    expect(meetsMinVoteGate({ upvotesCount: 6, downvotesCount: 4 })).toBe(true); // 0.60 exactly
    expect(meetsMinVoteGate({ upvotesCount: 6, downvotesCount: 5 })).toBe(false); // ratio < 0.60
    expect(meetsMinVoteGate({ upvotesCount: 5, downvotesCount: 0 })).toBe(false); // too few upvotes
    expect(meetsMinVoteGate({ upvotesCount: 0, downvotesCount: 0 })).toBe(false); // no votes
  });
});

describe('hasDemandOverride', () => {
  it('true when supporters ≥ 70% of active users', () => {
    expect(hasDemandOverride(7, 10)).toBe(true);
    expect(hasDemandOverride(6, 10)).toBe(false);
  });
  it('false when there are no active users', () => {
    expect(hasDemandOverride(0, 0)).toBe(false);
  });
});

describe('passesPlayabilityGate', () => {
  it('is open when the gate is inactive (small room), even with weak votes', () => {
    expect(
      passesPlayabilityGate({
        upvotesCount: 1,
        downvotesCount: 3,
        supporterCount: 1,
        activeUserCount: 5,
      }),
    ).toBe(true);
  });
  it('blocks a weak item at scale', () => {
    expect(
      passesPlayabilityGate({
        upvotesCount: 2,
        downvotesCount: 8,
        supporterCount: 2,
        activeUserCount: 20,
      }),
    ).toBe(false);
  });
  it('lets the 70%-demand override bypass the min-vote gate at scale', () => {
    // 8 supporters of 10 actives (≥70%) but only 3 raw upvotes counted — override still plays.
    expect(
      passesPlayabilityGate({
        upvotesCount: 3,
        downvotesCount: 0,
        supporterCount: 8,
        activeUserCount: 10,
      }),
    ).toBe(true);
  });
});

describe('isPlayableV1', () => {
  it('fails V0 basics regardless of votes (awaiting approval)', () => {
    const item = makeQueueItem({
      upvotesCount: 10,
      playabilityState: 'awaiting_approval',
    });
    expect(isPlayableV1(item, { controlMode: 'suggestion', activeUserCount: 3 })).toBe(false);
  });
  it('passes a healthy item at scale', () => {
    const item = makeQueueItem({ upvotesCount: 8, downvotesCount: 2 });
    expect(isPlayableV1(item, { controlMode: 'crowd', activeUserCount: 20 })).toBe(true);
  });
  it('gates a low-approval item at scale but not in a small room', () => {
    const item = makeQueueItem({ upvotesCount: 2, downvotesCount: 6 });
    expect(isPlayableV1(item, { controlMode: 'crowd', activeUserCount: 20 })).toBe(false);
    expect(isPlayableV1(item, { controlMode: 'crowd', activeUserCount: 4 })).toBe(true);
  });
});
