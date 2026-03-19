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
  durationMs?: number;
  userVote?: 1 | -1;
  isBoosted?: boolean;
  boostAmount?: number;
  userId?: string;
}

// Storage keys
const STORAGE_KEY_FINGERPRINT = 'vdj_device_fp';
const STORAGE_KEY_AUTH_TOKEN = 'vdj_auth_token';

export interface SessionState {
  // User identity (anonymous, device-based)
  deviceFingerprint: string | null;
  userId: string | null;
  displayName: string | null;
  influenceWeight: number;
  reputationScore: number;

  // Auth state
  isAuthenticated: boolean;
  authToken: string | null;
  authEmail: string | null;
  authProvider: string | null; // 'email' | 'instagram' | 'spotify' | null
  creditBalance: number;

  // Session data
  sessionId: string | null;
  venueId: string | null;
  energyLevel: number;
  isActive: boolean;

  // Song queue
  queue: Song[];
  nowPlaying: Song | null;

  // Actions
  initDevice: (customFingerprint?: string) => string;
  setUser: (userId: string, influenceWeight: number, reputationScore: number, displayName?: string | null) => void;
  setDisplayName: (displayName: string) => void;
  setSession: (sessionId: string, venueId: string, energyLevel: number) => void;
  setQueue: (queue: Song[]) => void;
  setNowPlaying: (song: Song | null) => void;
  updateUserVote: (requestId: string, vote: 1 | -1) => void;
  setCreditBalance: (creditBalance: number) => void;

  // Auth actions
  setAuthUser: (params: {
    userId: string;
    authToken: string;
    email: string | null;
    authProvider: string | null;
    displayName: string | null;
    reputationScore: number;
    influenceWeight: number;
    creditBalance: number;
    stayLoggedIn: boolean;
  }) => void;
  clearAuthUser: () => void;
  loadAuthFromStorage: () => string | null;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  deviceFingerprint: null,
  userId: null,
  displayName: null,
  influenceWeight: 1.0,
  reputationScore: 1.0,
  isAuthenticated: false,
  authToken: null,
  authEmail: null,
  authProvider: null,
  creditBalance: 0,
  sessionId: null,
  venueId: null,
  energyLevel: 0.5,
  isActive: false,
  queue: [],
  nowPlaying: null,

  initDevice: (customFingerprint?: string) => {
    if (typeof window === 'undefined') return '';

    // Use custom fingerprint for dev mode, otherwise use stored/generated
    let fp = customFingerprint;
    if (!fp) {
      fp = localStorage.getItem(STORAGE_KEY_FINGERPRINT);
      if (!fp) {
        fp = uuidv4();
        localStorage.setItem(STORAGE_KEY_FINGERPRINT, fp);
      }
    }
    set({ deviceFingerprint: fp });
    return fp;
  },

  setUser: (userId, influenceWeight, reputationScore, displayName = null) =>
    set({ userId, influenceWeight, reputationScore, displayName }),

  setDisplayName: (displayName) => set({ displayName }),

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

  setCreditBalance: (creditBalance) => set({ creditBalance }),

  setAuthUser: ({ userId, authToken, email, authProvider, displayName, reputationScore, influenceWeight, creditBalance, stayLoggedIn }) => {
    if (typeof window !== 'undefined') {
      const storage = stayLoggedIn ? localStorage : sessionStorage;
      storage.setItem(STORAGE_KEY_AUTH_TOKEN, authToken);
    }
    set({
      userId,
      authToken,
      authEmail: email,
      authProvider,
      displayName,
      reputationScore,
      influenceWeight,
      creditBalance,
      isAuthenticated: true,
    });
  },

  clearAuthUser: () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY_AUTH_TOKEN);
      sessionStorage.removeItem(STORAGE_KEY_AUTH_TOKEN);
    }
    set({
      isAuthenticated: false,
      authToken: null,
      authEmail: null,
      authProvider: null,
    });
  },

  loadAuthFromStorage: () => {
    if (typeof window === 'undefined') return null;
    const token =
      localStorage.getItem(STORAGE_KEY_AUTH_TOKEN) ||
      sessionStorage.getItem(STORAGE_KEY_AUTH_TOKEN);
    return token;
  },
}));

