/**
 * Postgres-backed repository implementations for the antispam module's
 * interfaces (friction.ts, sweeper.ts). Wire these against the shared pool
 * from `../db.js` at startup; tests stub the interfaces directly instead.
 */

import type { RecentlyPlayedArtistsRepository, VoteActivityRepository } from './friction.js';
import type { ReputationCounters, ReputationRepository } from './reputation.js';
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

const REPUTATION_COLUMNS: readonly (keyof ReputationCounters)[] = [
  'upvotesReceived',
  'downvotesReceived',
  'spamAttempts',
  'songsSkipped',
];

const REPUTATION_COLUMN_SQL: Readonly<Record<keyof ReputationCounters, string>> = {
  upvotesReceived: 'upvotes_received',
  downvotesReceived: 'downvotes_received',
  spamAttempts: 'spam_attempts',
  songsSkipped: 'songs_skipped',
};

function rowToCounters(row: {
  upvotes_received: number | string;
  downvotes_received: number | string;
  spam_attempts: number | string;
  songs_skipped: number | string;
}): ReputationCounters {
  return {
    upvotesReceived: Number(row.upvotes_received),
    downvotesReceived: Number(row.downvotes_received),
    spamAttempts: Number(row.spam_attempts),
    songsSkipped: Number(row.songs_skipped),
  };
}

export function createPgReputationRepository(pool: QueryablePool): ReputationRepository {
  return {
    async getCounters(userId: string): Promise<ReputationCounters | null> {
      const result = await pool.query<{
        upvotes_received: number | string;
        downvotes_received: number | string;
        spam_attempts: number | string;
        songs_skipped: number | string;
      }>(
        `select upvotes_received, downvotes_received, spam_attempts, songs_skipped
         from users
         where user_id = $1`,
        [userId],
      );
      const row = result.rows[0];
      return row ? rowToCounters(row) : null;
    },

    async incrementCounters(
      userId: string,
      delta: Partial<ReputationCounters>,
    ): Promise<ReputationCounters> {
      const assignments: string[] = [];
      const values: unknown[] = [userId];
      for (const key of REPUTATION_COLUMNS) {
        const amount = delta[key];
        if (typeof amount === 'number' && amount !== 0) {
          values.push(amount);
          const column = REPUTATION_COLUMN_SQL[key];
          assignments.push(`${column} = ${column} + $${values.length}`);
        }
      }
      const setClause =
        assignments.length > 0 ? assignments.join(', ') : 'upvotes_received = upvotes_received';
      const result = await pool.query<{
        upvotes_received: number | string;
        downvotes_received: number | string;
        spam_attempts: number | string;
        songs_skipped: number | string;
      }>(
        `update users set ${setClause}
         where user_id = $1
         returning upvotes_received, downvotes_received, spam_attempts, songs_skipped`,
        values,
      );
      const row = result.rows[0];
      if (!row) throw new Error(`user ${userId} not found`);
      return rowToCounters(row);
    },

    async setReputationScore(userId: string, score: number): Promise<void> {
      await pool.query(`update users set reputation_score = $2 where user_id = $1`, [
        userId,
        score,
      ]);
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
