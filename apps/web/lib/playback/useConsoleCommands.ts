'use client';

/**
 * Subscribes the venue console to playback_command events on its channel.
 *
 * Real mode: opens a dedicated console WebSocket
 *   /ws/venues/:venueId?role=console&token=<venueAdminToken>
 * (the server only sends playback_command to console-role connections).
 * Mock mode (NEXT_PUBLIC_API_MOCK=1): subscribes to the in-memory event bus,
 * which the mock API client publishes playback_command frames onto.
 *
 * Only playback_command frames are surfaced; the panel's now-playing readout
 * comes from the page's existing useVenueChannel. Kept out of the shared
 * realtimeReducer so that patron-facing state stays untouched.
 */

import { useEffect } from 'react';
import type { PlaybackCommandEvent, RealtimeEvent } from '@openaux/shared';

import { isMockMode, wsBaseUrl } from '../config';
import { mockEventBus } from '../mock/eventBus';

export function useConsoleCommands(
  venueId: string | null,
  token: string | null,
  enabled: boolean,
  onCommand: (payload: PlaybackCommandEvent['payload']) => void,
): void {
  useEffect(() => {
    if (!venueId || !enabled) return;

    const handle = (event: RealtimeEvent): void => {
      if (event.type === 'playback_command') onCommand(event.payload);
    };

    if (isMockMode()) {
      return mockEventBus.subscribe(venueId, handle);
    }

    const params = new URLSearchParams({ role: 'console' });
    if (token) params.set('token', token);
    const socket = new WebSocket(`${wsBaseUrl()}/ws/venues/${venueId}?${params.toString()}`);
    socket.onmessage = (message) => {
      try {
        handle(JSON.parse(message.data as string) as RealtimeEvent);
      } catch {
        // Ignore malformed frames rather than crashing the console channel.
      }
    };
    return () => socket.close();
  }, [venueId, token, enabled, onCommand]);
}
