/**
 * Zustand store for session state.
 * Manages current user identity, session data, and song queue.
 *
 * Scaling Path:
 * - Replace polling with WebSocket subscription
 * - Add optimistic updates for votes
 */

import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';

export interface Song {
  requestId: string;
  songId: string;
  title: string;
  artist: string;
  score: number;
  voteCount: number;
  userVote?: 1 | -1;
}

export interface SessionState {
  // User identity (anonymous, device-based)
  deviceFingerprint: string | null;
  userId: string | null;
  influenceWeight: number;
  reputationScore: number;

  // Session data
  sessionId: string | null;
  venueId: string | null;
  energyLevel: number;
  isActive: boolean;

  // Song queue
  queue: Song[];
  nowPlaying: Song | null;

  // Actions
  initDevice: () => string;
  setUser: (userId: string, influenceWeight: number, reputationScore: number) => void;
  setSession: (sessionId: string, venueId: string, energyLevel: number) => void;
  setQueue: (queue: Song[]) => void;
  setNowPlaying: (song: Song | null) => void;
  updateUserVote: (requestId: string, vote: 1 | -1) => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  deviceFingerprint: null,
  userId: null,
  influenceWeight: 1.0,
  reputationScore: 1.0,
  sessionId: null,
  venueId: null,
  energyLevel: 0.5,
  isActive: false,
  queue: [],
  nowPlaying: null,

  initDevice: () => {
    if (typeof window === 'undefined') return '';
    let fp = localStorage.getItem('vdj_device_fp');
    if (!fp) {
      fp = uuidv4();
      localStorage.setItem('vdj_device_fp', fp);
    }
    set({ deviceFingerprint: fp });
    return fp;
  },

  setUser: (userId, influenceWeight, reputationScore) =>
    set({ userId, influenceWeight, reputationScore }),

  setSession: (sessionId, venueId, energyLevel) =>
    set({ sessionId, venueId, energyLevel, isActive: true }),

  setQueue: (queue) => set({ queue }),

  setNowPlaying: (nowPlaying) => set({ nowPlaying }),

  updateUserVote: (requestId, vote) =>
    set((state) => ({
      queue: state.queue.map((s) =>
        s.requestId === requestId ? { ...s, userVote: vote } : s,
      ),
    })),
}));
