/**
 * Simple in-memory cache for ranked queue
 * Reduces database load by caching queue calculations
 */

import { ScoredRequest } from './virtualDjEngine';

interface CacheEntry {
  data: ScoredRequest[];
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 10000; // 10 seconds

export function getCachedQueue(sessionId: string): ScoredRequest[] | null {
  const entry = cache.get(sessionId);
  if (!entry) return null;

  const age = Date.now() - entry.timestamp;
  if (age > CACHE_TTL_MS) {
    cache.delete(sessionId);
    return null;
  }

  return entry.data;
}

export function setCachedQueue(sessionId: string, queue: ScoredRequest[]): void {
  cache.set(sessionId, {
    data: queue,
    timestamp: Date.now(),
  });
}

export function invalidateQueueCache(sessionId: string): void {
  cache.delete(sessionId);
}

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, entry] of cache.entries()) {
    if (now - entry.timestamp > CACHE_TTL_MS * 6) {
      cache.delete(sessionId);
    }
  }
}, 5 * 60 * 1000);
