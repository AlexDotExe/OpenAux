/**
 * Minimal analytics seam (SPEC.md §1 layer 6: "log everything independently
 * of live queue logic"). Sessions/realtime emit through this interface;
 * WS6 (apps/server/src/analytics/) provides the real async pipeline and
 * injects it at wiring time. Never let a missing emitter block a join.
 */
import type { AnalyticsEventType } from '@openaux/shared';

export interface EmitAnalyticsEventInput {
  eventType: AnalyticsEventType;
  actorUserId: string | null;
  venueId: string;
  queueItemId: string | null;
  metadata: Record<string, unknown>;
}

export interface AnalyticsEventEmitter {
  emitAnalyticsEvent(input: EmitAnalyticsEventInput): void;
}

/** No-op default so callers can omit injection in tests/dev without crashing. */
export const noopAnalyticsEmitter: AnalyticsEventEmitter = {
  emitAnalyticsEvent() {
    // intentionally no-op; WS6 provides the real sink.
  },
};
