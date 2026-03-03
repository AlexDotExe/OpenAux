/**
 * STUB: Reputation Recalculation Job
 *
 * Scaling Path:
 * - This stub will become a scheduled background job (e.g., BullMQ, cron)
 * - Triggered after each session ends or on a nightly schedule
 * - Will batch-process all users' reputation scores
 *
 * NOT IMPLEMENTED in MVP.
 */

export interface ReputationJobPayload {
  userId: string;
  sessionId: string;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function scheduleReputationRecalculation(_payload: ReputationJobPayload): Promise<void> {
  // TODO: Enqueue to BullMQ/Redis queue
  // await reputationQueue.add('recalculate', payload);
  console.warn('[STUB] scheduleReputationRecalculation - not implemented');
}
