/**
 * V0 logging-only aggregate queries (SPEC.md §5, "Analytics (log only, no UI)").
 * No UI consumes these in V0 — they exist for ops/debugging visibility and as
 * the seam V3's analytics UI will build on.
 *
 * Each function takes a `QueryablePool` (structurally compatible with pg's
 * Pool.query) so tests can stub it without a live database.
 */

export interface QueryablePool {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: Row[] }>;
}

// ---------------------------------------------------------------------------
// Songs requested via OpenAux vs total played
// ---------------------------------------------------------------------------

export interface RequestedVsPlayedCounts {
  venueId: string;
  /** Songs that both originated as an organic OpenAux request and were played. */
  requestedViaOpenAux: number;
  /** All queue_items that reached status = played at this venue. */
  totalPlayed: number;
}

export async function getRequestedVsPlayedCounts(
  pool: QueryablePool,
  venueId: string,
): Promise<RequestedVsPlayedCounts> {
  const result = await pool.query<{ requested_via_open_aux: string; total_played: string }>(
    `select
       count(*) filter (where source_type = 'organic' and status = 'played') as requested_via_open_aux,
       count(*) filter (where status = 'played') as total_played
     from queue_items
     where venue_id = $1`,
    [venueId],
  );
  const row = result.rows[0];
  return {
    venueId,
    requestedViaOpenAux: Number(row?.requested_via_open_aux ?? 0),
    totalPlayed: Number(row?.total_played ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Revenue per venue
// ---------------------------------------------------------------------------

export interface VenueRevenue {
  venueId: string;
  revenueCents: number;
}

export interface GetRevenuePerVenueOptions {
  venueId?: string;
  since?: Date;
}

export async function getRevenuePerVenue(
  pool: QueryablePool,
  options: GetRevenuePerVenueOptions = {},
): Promise<VenueRevenue[]> {
  const conditions = [`status = 'completed'`];
  const params: unknown[] = [];

  if (options.venueId) {
    params.push(options.venueId);
    conditions.push(`venue_id = $${params.length}`);
  }
  if (options.since) {
    params.push(options.since);
    conditions.push(`created_at >= $${params.length}`);
  }

  const result = await pool.query<{ venue_id: string; revenue_cents: string }>(
    `select venue_id, sum(cash_amount_cents) as revenue_cents
     from payment_events
     where ${conditions.join(' and ')}
     group by venue_id`,
    params,
  );

  return result.rows.map((row) => ({
    venueId: row.venue_id,
    revenueCents: Number(row.revenue_cents ?? 0),
  }));
}

// ---------------------------------------------------------------------------
// Votes per song
// ---------------------------------------------------------------------------

export interface SongVoteCounts {
  queueItemId: string;
  artist: string;
  title: string;
  upvotes: number;
  downvotes: number;
}

export async function getVotesPerSong(
  pool: QueryablePool,
  venueId: string,
): Promise<SongVoteCounts[]> {
  const result = await pool.query<{
    queue_item_id: string;
    artist: string;
    title: string;
    upvotes: string;
    downvotes: string;
  }>(
    `select
       qi.queue_item_id,
       qi.artist,
       qi.title,
       count(*) filter (where v.direction = 'up') as upvotes,
       count(*) filter (where v.direction = 'down') as downvotes
     from queue_items qi
     left join votes v on v.queue_item_id = qi.queue_item_id
     where qi.venue_id = $1
     group by qi.queue_item_id, qi.artist, qi.title`,
    [venueId],
  );

  return result.rows.map((row) => ({
    queueItemId: row.queue_item_id,
    artist: row.artist,
    title: row.title,
    upvotes: Number(row.upvotes ?? 0),
    downvotes: Number(row.downvotes ?? 0),
  }));
}

// ---------------------------------------------------------------------------
// Active users per venue
// ---------------------------------------------------------------------------

export interface VenueActiveUsers {
  venueId: string;
  activeUsers: number;
}

export async function getActiveUsersPerVenue(
  pool: QueryablePool,
  venueId?: string,
): Promise<VenueActiveUsers[]> {
  const params: unknown[] = [];
  let whereClause = 'where is_active = true';
  if (venueId) {
    params.push(venueId);
    whereClause += ` and venue_id = $${params.length}`;
  }

  const result = await pool.query<{ venue_id: string; active_users: string }>(
    `select venue_id, count(distinct user_id) as active_users
     from sessions
     ${whereClause}
     group by venue_id`,
    params,
  );

  return result.rows.map((row) => ({
    venueId: row.venue_id,
    activeUsers: Number(row.active_users ?? 0),
  }));
}
