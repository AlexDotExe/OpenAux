import { describe, expect, it } from 'vitest';
import { applyApprovalDecision } from './approval-logic.js';

describe('applyApprovalDecision', () => {
  it('approve flips playability_state awaiting_approval -> playable', () => {
    const outcome = applyApprovalDecision(
      { status: 'queued', playabilityState: 'awaiting_approval' },
      'approve',
    );
    expect(outcome).toEqual({ ok: true, playabilityState: 'playable' });
  });

  it('reject sets status -> blocked', () => {
    const outcome = applyApprovalDecision(
      { status: 'queued', playabilityState: 'awaiting_approval' },
      'reject',
    );
    expect(outcome).toEqual({ ok: true, status: 'blocked' });
  });

  it('refuses to decide an item that is not awaiting approval (already playable)', () => {
    const outcome = applyApprovalDecision(
      { status: 'queued', playabilityState: 'playable' },
      'approve',
    );
    expect(outcome).toEqual({ ok: false, reason: 'not_awaiting_approval' });
  });

  it('refuses to decide an item that is not awaiting approval (already blocked)', () => {
    const outcome = applyApprovalDecision(
      { status: 'blocked', playabilityState: 'held' },
      'reject',
    );
    expect(outcome).toEqual({ ok: false, reason: 'not_awaiting_approval' });
  });
});
