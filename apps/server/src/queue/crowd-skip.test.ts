import { describe, expect, it } from 'vitest';
import { crowdSkipThreshold, shouldCrowdSkip } from './crowd-skip.js';
import { CROWD_SKIP_MIN_VOTES } from './constants.js';

describe('crowdSkipThreshold', () => {
  it('floors at CROWD_SKIP_MIN_VOTES for tiny rooms', () => {
    expect(crowdSkipThreshold(0)).toBe(CROWD_SKIP_MIN_VOTES);
    expect(crowdSkipThreshold(2)).toBe(CROWD_SKIP_MIN_VOTES); // ceil(0.5·2)=1 < floor
  });
  it('is a simple majority (ceil of half) once the room is large enough', () => {
    expect(crowdSkipThreshold(10)).toBe(5);
    expect(crowdSkipThreshold(11)).toBe(6); // ceil(5.5)
  });
});

describe('shouldCrowdSkip', () => {
  it('is true only at/above the threshold', () => {
    expect(shouldCrowdSkip(4, 10)).toBe(false);
    expect(shouldCrowdSkip(5, 10)).toBe(true);
    expect(shouldCrowdSkip(6, 10)).toBe(true);
  });
});
