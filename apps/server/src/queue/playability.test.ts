import { describe, expect, it } from 'vitest';
import { passesMinVoteGate } from './playability.js';

describe('passesMinVoteGate', () => {
  it('is off entirely below the 10-active-user floor, regardless of votes', () => {
    expect(
      passesMinVoteGate({
        upvotesCount: 0,
        downvotesCount: 100,
        gate: { activeUserCount: 9 },
      }),
    ).toBe(true);
  });

  it('holds an item that fails both the upvote floor and the ratio once >=10 actives', () => {
    expect(
      passesMinVoteGate({
        upvotesCount: 2,
        downvotesCount: 2,
        gate: { activeUserCount: 10 },
      }),
    ).toBe(false);
  });

  it('holds an item with enough upvotes but too low a positive ratio', () => {
    expect(
      passesMinVoteGate({
        upvotesCount: 6,
        downvotesCount: 10, // ratio 6/16 = 0.375 < 0.60
        gate: { activeUserCount: 10 },
      }),
    ).toBe(false);
  });

  it('holds an item with a good ratio but too few raw upvotes', () => {
    expect(
      passesMinVoteGate({
        upvotesCount: 3,
        downvotesCount: 1, // ratio 0.75 >= 0.60, but upvotes < 6
        gate: { activeUserCount: 10 },
      }),
    ).toBe(false);
  });

  it('passes once both up>=6 and ratio>=0.60 are met', () => {
    expect(
      passesMinVoteGate({
        upvotesCount: 6,
        downvotesCount: 4, // ratio 0.6
        gate: { activeUserCount: 10 },
      }),
    ).toBe(true);
  });

  it('70%-of-actives override passes regardless of the ratio/count threshold', () => {
    expect(
      passesMinVoteGate({
        upvotesCount: 7, // 7 >= 0.7 * 10
        downvotesCount: 20,
        gate: { activeUserCount: 10 },
      }),
    ).toBe(true);
  });

  it('treats zero votes as a 0 ratio (fails the gate once active, no divide-by-zero)', () => {
    expect(
      passesMinVoteGate({
        upvotesCount: 0,
        downvotesCount: 0,
        gate: { activeUserCount: 10 },
      }),
    ).toBe(false);
  });
});
