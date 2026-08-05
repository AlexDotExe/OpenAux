'use client';

/**
 * WebSocket hook for the per-venue realtime channel (WS /ws/venues/:venueId,
 * see CONTRACTS.md + packages/shared/src/contracts/realtime-events.ts).
 *
 * Dispatches queue_updated / now_playing_changed / announcement /
 * session_expired into a small reducer (lib/realtimeReducer.ts, unit tested
 * independently). In mock mode (NEXT_PUBLIC_API_MOCK=1) there is no real
 * socket — it subscribes to the in-memory mock event bus instead, so the
 * mock API client can simulate realtime pushes after every mutating call.
 */

import { useCallback, useEffect, useReducer, useState } from 'react';
import type { RealtimeEvent } from '@openaux/shared';

import { isMockMode, wsBaseUrl } from './config';
import { mockEventBus } from './mock/eventBus';
import {
  applyRealtimeEvent,
  initialVenueChannelState,
  type VenueChannelAction,
  type VenueChannelState,
} from './realtimeReducer';

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'closed';

export interface UseVenueChannelResult extends VenueChannelState {
  connectionState: ConnectionState;
  dismissAnnouncement: (id: string) => void;
}

export function useVenueChannel(venueId: string | null): UseVenueChannelResult {
  const [state, dispatch] = useReducer(applyRealtimeEvent, initialVenueChannelState);
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');

  useEffect(() => {
    if (!venueId) return;

    if (isMockMode()) {
      setConnectionState('open');
      const unsubscribe = mockEventBus.subscribe(venueId, (event: RealtimeEvent) => {
        dispatch(event);
      });
      return () => {
        unsubscribe();
        setConnectionState('closed');
      };
    }

    setConnectionState('connecting');
    const socket = new WebSocket(`${wsBaseUrl()}/ws/venues/${venueId}`);

    socket.onopen = () => setConnectionState('open');
    socket.onclose = () => setConnectionState('closed');
    socket.onerror = () => setConnectionState('closed');
    socket.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data as string) as RealtimeEvent;
        dispatch(event);
      } catch {
        // Ignore malformed frames rather than crashing the channel.
      }
    };

    return () => {
      socket.close();
    };
  }, [venueId]);

  const dismissAnnouncement = useCallback((id: string) => {
    dispatch({ type: 'dismiss_announcement', id } satisfies VenueChannelAction);
  }, []);

  return { ...state, connectionState, dismissAnnouncement };
}
