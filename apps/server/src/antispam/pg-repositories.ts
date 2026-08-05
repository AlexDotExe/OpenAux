/**
 * Postgres-backed repository implementations for the antispam module's
 * interfaces (friction.ts, sweeper.ts). Wire these against the shared pool
 * from `../db.js` at startup; tests stub the interfaces directly instead.
 */

import type { RecentlyPlayedArtistsRepository, VoteActivityRepository } from './friction.js';
import type { ExpiredSessionCandidate, SessionRepository } from './sweeper.js';

/** Minimal shape we need from `pg`'s Pool — keeps this file test-stubbable. */
export interface QueryablePool {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: Row[] }>;
}

/**
 * "Recently played" ordered by actual play time (`played_at desc`), added to
 * queue_items in the 2026-07-24 contract change. Rows played before that column
 * existed have a null played_at and sort last (NULLS LAST).
 */
export function createPgRecentArtistsRepository(
  pool: QueryablePool,
): RecentlyPlayedArtistsRepository {
  return {
    async getRecentArtists(venueId: string, limit: number): Promise<string[]> {
      const result = await pool.query<{ artist: string }>(
        `select artist
         from queue_items
         where venue_id = $1 and status = 'played'
         order by played_at desc nulls last
         limit $2`,
        [venueId, limit],
      );
      return result.rows.map((row) => row.artist);
    },
  };
}

export function createPgVoteActivityRepository(pool: QueryablePool): VoteActivityRepository {
  return {
    async getVoteCountsSince(
      venueId: string,
      userIds: readonly string[],
      since: Date,
    ): Promise<Map<string, number>> {
      if (userIds.length === 0) return new Map();
      const result = await pool.query<{ user_id: string; vote_count: string }>(
        `select v.user_id, count(*) as vote_count
         from votes v
         join queue_items qi on qi.queue_item_id = v.queue_item_id
         where qi.venue_id = $1 and v.user_id = any($2::uuid[]) and v.created_at >= $3
         group by v.user_id`,
        [venueId, [...userIds], since],
      );
      return new Map(result.rows.map((row) => [row.user_id, Number(row.vote_count)]));
    },
  };
}

export function createPgSessionRepository(pool: QueryablePool): SessionRepository {
  return {
    async findActiveSessionsOlderThan(cutoff: Date): Promise<ExpiredSessionCandidate[]> {
      const result = await pool.query<{
        session_id: string;
        user_id: string;
        venue_id: string;
        last_active_at: Date;
      }>(
        `select session_id, user_id, venue_id, last_active_at
         from sessions
         where is_active = true and last_active_at <= $1`,
        [cutoff],
      );
      return result.rows.map((row) => ({
        sessionId: row.session_id,
        userId: row.user_id,
        venueId: row.venue_id,
        lastActiveAt: new Date(row.last_active_at),
      }));
    },

    async markSessionExpired(sessionId: string, expiredAt: Date): Promise<void> {
      await pool.query(
        `update sessions
         set is_active = false, session_expired_at = $2
         where session_id = $1 and is_active = true`,
        [sessionId, expiredAt],
      );
    },
  };
}
