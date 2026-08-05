/**
 * In-memory stand-in for the per-venue WebSocket channel, used only when
 * NEXT_PUBLIC_API_MOCK=1. The mock API client (mockApiClient.ts) publishes
 * RealtimeEvent frames here after every mutating call, and useVenueChannel
 * subscribes here instead of opening a real socket. This is what makes the
 * mocked screens feel live (queue reorders, announcements) without a backend.
 */

import type { RealtimeEvent } from '@openaux/shared';

type Listener = (event: RealtimeEvent) => void;

class MockVenueEventBus {
  private listenersByVenue = new Map<string, Set<Listener>>();

  subscribe(venueId: string, listener: Listener): () => void {
    let set = this.listenersByVenue.get(venueId);
    if (!set) {
      set = new Set();
      this.listenersByVenue.set(venueId, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
    };
  }

  publish(venueId: string, event: RealtimeEvent): void {
    const set = this.listenersByVenue.get(venueId);
    if (!set) return;
    for (const listener of set) listener(event);
  }
}

/** Singleton so the mock API client and every useVenueChannel() call share it. */
export const mockEventBus = new MockVenueEventBus();
