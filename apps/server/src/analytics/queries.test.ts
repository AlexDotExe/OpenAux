import { describe, expect, it, vi } from 'vitest';
import {
  getActiveUsersPerVenue,
  getRequestedVsPlayedCounts,
  getRevenuePerVenue,
  getVotesPerSong,
  type QueryablePool,
} from './queries.js';

function makePool(rows: Record<string, unknown>[]): QueryablePool {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

describe('getRequestedVsPlayedCounts', () => {
  it('queries queue_items filtered by venue and maps counts', async () => {
    const pool = makePool([{ requested_via_open_aux: '7', total_played: '20' }]);

    const result = await getRequestedVsPlayedCounts(pool, 'venue-1');

    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('from queue_items'), [
      'venue-1',
    ]);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("status = 'played'"), [
      'venue-1',
    ]);
    expect(result).toEqual({ venueId: 'venue-1', requestedViaOpenAux: 7, totalPlayed: 20 });
  });

  it('defaults to zero counts when no row is returned', async () => {
    const pool = makePool([]);
    const result = await getRequestedVsPlayedCounts(pool, 'venue-1');
    expect(result).toEqual({ venueId: 'venue-1', requestedViaOpenAux: 0, totalPlayed: 0 });
  });
});

describe('getRevenuePerVenue', () => {
  it('queries payment_events restricted to completed status', async () => {
    const pool = makePool([{ venue_id: 'venue-1', revenue_cents: '1500' }]);

    const result = await getRevenuePerVenue(pool);

    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('from payment_events'), []);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("status = 'completed'"), []);
    expect(result).toEqual([{ venueId: 'venue-1', revenueCents: 1500 }]);
  });

  it('adds a venue_id filter and param when venueId is given', async () => {
    const pool = makePool([{ venue_id: 'venue-1', revenue_cents: '500' }]);

    await getRevenuePerVenue(pool, { venueId: 'venue-1' });

    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('venue_id = $1'), ['venue-1']);
  });

  it('adds a since filter alongside venueId with correct positional params', async () => {
    const pool = makePool([]);
    const since = new Date('2026-07-01T00:00:00Z');

    await getRevenuePerVenue(pool, { venueId: 'venue-1', since });

    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('created_at >= $2'), [
      'venue-1',
      since,
    ]);
  });
});

describe('getVotesPerSong', () => {
  it('joins queue_items to votes and maps up/down counts', async () => {
    const pool = makePool([
      { queue_item_id: 'item-1', artist: 'Drake', title: 'Song', upvotes: '5', downvotes: '2' },
    ]);

    const result = await getVotesPerSong(pool, 'venue-1');

    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('left join votes'), [
      'venue-1',
    ]);
    expect(result).toEqual([
      { queueItemId: 'item-1', artist: 'Drake', title: 'Song', upvotes: 5, downvotes: 2 },
    ]);
  });
});

describe('getActiveUsersPerVenue', () => {
  it('filters sessions by is_active and groups by venue', async () => {
    const pool = makePool([{ venue_id: 'venue-1', active_users: '42' }]);

    const result = await getActiveUsersPerVenue(pool);

    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('is_active = true'), []);
    expect(result).toEqual([{ venueId: 'venue-1', activeUsers: 42 }]);
  });

  it('adds a venue_id filter when given', async () => {
    const pool = makePool([{ venue_id: 'venue-1', active_users: '3' }]);

    await getActiveUsersPerVenue(pool, 'venue-1');

    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('venue_id = $1'), ['venue-1']);
  });
});
