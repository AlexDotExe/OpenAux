/**
 * Session-lookup seam for actor resolution.
 *
 * Payments must not import WS1's sessions module internals (CLAUDE.md ownership
 * map + SPEC.md §1 layer separation), so settlement depends only on this narrow
 * read-only interface: session id -> acting user + venue context. The Postgres
 * implementation below owns the single SELECT it needs; tests use the in-memory
 * double in memory-repo.ts.
 */
import type { PgLike } from './repo.js';

/** Actor identity + venue context derived from an active session row. */
export interface SessionActor {
  userId: string;
  venueId: string;
}

export interface SessionActorRepo {
  /**
   * Resolve an ACTIVE session to its user + venue. Returns null when the
   * session id is unknown, malformed, or no longer active — the resolver then
   * falls back to the legacy headers and ultimately raises `unauthorized`.
   */
  findActorBySessionId(sessionId: string): Promise<SessionActor | null>;
}

/** sessions.session_id is a uuid; anything else can never match a row. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Postgres-backed lookup over the shared pool. Reads `sessions` only — it never
 * writes, so session lifecycle (touch/expire) stays owned by WS1.
 */
export class PgSessionActorRepo implements SessionActorRepo {
  constructor(private readonly db: PgLike) {}

  async findActorBySessionId(sessionId: string): Promise<SessionActor | null> {
    // Guard before hitting SQL: a non-uuid would raise invalid_text_representation.
    if (!UUID_RE.test(sessionId)) return null;
    const result = await this.db.query(
      'select user_id, venue_id from sessions where session_id = $1 and is_active',
      [sessionId],
    );
    const row = result.rows[0] as { user_id: string; venue_id: string } | undefined;
    if (!row) return null;
    return { userId: row.user_id, venueId: row.venue_id };
  }
}
