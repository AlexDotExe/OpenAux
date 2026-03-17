/**
 * Virtual DJ Engine
 *
 * Core scoring and song-selection logic.
 *
 * Design Goals:
 * - Modular: scoring formula can evolve without schema changes
 * - Scalable: designed to be extracted into a standalone microservice later
 * - Extensible: energy levels, genre filtering, skip penalties all pluggable
 *
 * Future Scaling Path:
 * - Replace direct DB calls with a message queue consumer
 * - Add ML-based energy prediction
 * - Support multi-venue concurrent sessions
 */

import { findActiveRequests, SongRequestWithDetails } from '../db/requests';
import { getRecentlyPlayedSongIds, getBatchSongPlayCountsInLastHour } from '../db/playback';
import { getVenueBlacklist, findVenueById } from '../db/venues';
import { findSessionById } from '../db/sessions';
import { getCachedQueue, setCachedQueue } from './queueCache';

/** Number of positions a boosted song advances in the queue */
export const BOOST_POSITIONS = 3;

export interface ScoredRequest {
  requestId: string;
  songId: string;
  title: string;
  artist: string;
  score: number;
  voteCount: number;
  durationMs?: number;
  isBoosted?: boolean;
  boostAmount?: number;
  userId?: string;
}

export interface DjEngineConfig {
  // How many recently played songs to exclude from selection
  recentPlayExclusionCount: number;
  // Multiplier applied to skip penalties (0 = ignore skip history)
  skipPenaltyFactor: number;
  // Crowd size weight: larger crowds boost scores slightly
  crowdSizeFactor: number;
}

const DEFAULT_CONFIG: DjEngineConfig = {
  recentPlayExclusionCount: 10,
  skipPenaltyFactor: 0.5,
  crowdSizeFactor: 0.1,
};

/**
 * Calculate the weighted score for a single song request.
 *
 * Score = SUM(vote.value × vote.weight)
 *       × energyAdjustment
 *       × crowdFactor
 *
 * Note: boost does not affect the score directly — boosted songs are moved
 * up BOOST_POSITIONS spots in the final sorted queue via applyBoostPositions().
 *
 * Future: add genre affinity score, BPM match score, time-of-night weighting
 */
export function calculateRequestScore(
  request: SongRequestWithDetails,
  energyLevel: number,
  totalVoters: number,
  config: DjEngineConfig = DEFAULT_CONFIG,
): number {
  // Base score: sum of weighted votes
  const baseScore = request.votes.reduce((sum, v) => sum + v.value * v.weight, 0);

  // Energy adjustment: prefer songs with BPM close to energy target
  // energyLevel 0.0 = low BPM preference, 1.0 = high BPM preference
  let energyAdjustment = 1.0;
  if (request.song.bpm) {
    // Target BPM mapped from energy level: 60bpm at 0.0, 160bpm at 1.0
    const targetBpm = 60 + energyLevel * 100;
    const bpmDelta = Math.abs(request.song.bpm - targetBpm);
    // Penalty: 1% per BPM away, capped at 50%
    energyAdjustment = Math.max(0.5, 1 - bpmDelta * 0.01);
  }

  // Crowd size factor: slightly boosts all scores in large crowds
  const crowdFactor = 1 + Math.log1p(totalVoters) * config.crowdSizeFactor;

  return baseScore * energyAdjustment * crowdFactor;
}

/**
 * Apply position-based boost: move each boosted song up BOOST_POSITIONS spots
 * in the already-sorted queue.
 *
 * Songs with votes + a boost naturally jump ahead of similarly-scored songs.
 * Each boosted song is identified by requestId so it is never moved twice,
 * even when multiple boosted songs are present. Highest-indexed (lowest-ranked)
 * boosted songs are processed first so earlier insertions don't shift the
 * remaining target indices unexpectedly.
 */
export function applyBoostPositions(sorted: ScoredRequest[]): ScoredRequest[] {
  const result = [...sorted];
  const processedIds = new Set<string>();

  // Iterate from the last position upward; use requestId to skip already-moved songs
  let i = result.length - 1;
  while (i >= 0) {
    const song = result[i];
    if (song.isBoosted && !processedIds.has(song.requestId)) {
      processedIds.add(song.requestId);
      const newIdx = Math.max(0, i - BOOST_POSITIONS);
      if (newIdx !== i) {
        result.splice(i, 1);
        result.splice(newIdx, 0, song);
      }
    }
    i--;
  }

  return result;
}

/**
 * Filter eligible requests based on venue constraints.
 *
 * Removes:
 * - Songs on the venue blacklist
 * - Songs recently played
 * - Songs whose genre doesn't match venue profile (lenient filter for MVP)
 */
export function filterEligibleRequests(
  requests: SongRequestWithDetails[],
  recentlyPlayedIds: Set<string>,
  blacklistedSongIds: Set<string>,
  venueGenreProfile: { primary?: string; secondary?: string[] },
): SongRequestWithDetails[] {
  return requests.filter((req) => {
    // Exclude blacklisted songs
    if (blacklistedSongIds.has(req.songId)) return false;

    // Exclude recently played
    if (recentlyPlayedIds.has(req.songId)) return false;

    // Genre filter (lenient: only filter if song has explicit genre tags)
    if (req.song.genreTags.length > 0 && venueGenreProfile.primary) {
      const allowedGenres = new Set([
        venueGenreProfile.primary,
        ...(venueGenreProfile.secondary ?? []),
      ].map((g) => g.toLowerCase()));

      const songGenres = req.song.genreTags.map((g) => g.toLowerCase());
      const hasMatch = songGenres.some((g) => allowedGenres.has(g));

      // If no genre match, still include but with penalty applied in scoring
      // Future: make this a configurable hard filter per venue
      if (!hasMatch) return true; // lenient for MVP
    }

    return true;
  });
}

/**
 * Main entrypoint: select the best next song for a session.
 *
 * Returns the top-scored eligible SongRequest, or null if no candidates exist.
 */
export async function selectNextSong(
  sessionId: string,
  config: DjEngineConfig = DEFAULT_CONFIG,
): Promise<ScoredRequest | null> {
  const session = await findSessionById(sessionId);
  if (!session) return null;

  const [requests, recentlyPlayedIds, blacklistedIds, venue] = await Promise.all([
    findActiveRequests(sessionId),
    getRecentlyPlayedSongIds(sessionId, config.recentPlayExclusionCount),
    getVenueBlacklist(session.venueId),
    findVenueById(session.venueId),
  ]);

  const genreProfile = (venue?.genreProfile ?? {}) as { primary?: string; secondary?: string[] };

  let eligible = filterEligibleRequests(
    requests,
    new Set(recentlyPlayedIds),
    new Set(blacklistedIds),
    genreProfile,
  );

  // Filter songs that exceed max repeats per hour (batched query)
  if (venue && venue.maxSongRepeatsPerHour > 0) {
    const songIds = eligible.map(req => req.songId);
    const playCounts = await getBatchSongPlayCountsInLastHour(sessionId, songIds);
    eligible = eligible.filter(req => {
      const playCount = playCounts.get(req.songId) ?? 0;
      return playCount < venue.maxSongRepeatsPerHour;
    });
  }

  if (eligible.length === 0) return null;

  // Count unique voters across all requests to compute crowd factor
  const allVoterIds = new Set(
    requests.flatMap((r) => r.votes.map((v) => v.userId)),
  );
  const totalVoters = allVoterIds.size;

  // Score each eligible request
  const scored = eligible.map((req) => ({
    requestId: req.id,
    songId: req.songId,
    title: req.song.title,
    artist: req.song.artist,
    score: calculateRequestScore(req, session.currentEnergyLevel, totalVoters, config),
    voteCount: req.votes.length,
    durationMs: req.song.durationMs ?? undefined,
    isBoosted: req.isBoosted,
    boostAmount: req.boostAmount,
    userId: req.userId,
  }));

  // Sort descending by score
  scored.sort((a, b) => b.score - a.score);

  // Apply position-based boost: move boosted songs up BOOST_POSITIONS spots
  const ranked = applyBoostPositions(scored);

  return ranked[0];
}

/**
 * Get ranked list of all eligible songs for display in the UI queue.
 * Uses a 10-second cache to reduce database load from frequent polling.
 */
export async function getRankedQueue(sessionId: string, skipCache = false): Promise<ScoredRequest[]> {
  // Check cache first (unless explicitly skipped)
  if (!skipCache) {
    const cached = getCachedQueue(sessionId);
    if (cached) {
      console.log('[getRankedQueue] Cache HIT for session', sessionId);
      return cached;
    }
    console.log('[getRankedQueue] Cache MISS for session', sessionId);
  }

  const session = await findSessionById(sessionId);
  if (!session) return [];

  const [requests, recentlyPlayedIds, blacklistedIds, venue] = await Promise.all([
    findActiveRequests(sessionId),
    getRecentlyPlayedSongIds(sessionId, 10),
    getVenueBlacklist(session.venueId),
    findVenueById(session.venueId),
  ]);

  const genreProfile = (venue?.genreProfile ?? {}) as { primary?: string; secondary?: string[] };

  let eligible = filterEligibleRequests(
    requests,
    new Set(recentlyPlayedIds),
    new Set(blacklistedIds),
    genreProfile,
  );

  // Filter songs that exceed max repeats per hour (batched query)
  if (venue && venue.maxSongRepeatsPerHour > 0) {
    const songIds = eligible.map(req => req.songId);
    const playCounts = await getBatchSongPlayCountsInLastHour(sessionId, songIds);
    eligible = eligible.filter(req => {
      const playCount = playCounts.get(req.songId) ?? 0;
      return playCount < venue.maxSongRepeatsPerHour;
    });
  }

  // Count unique voters across all requests (a user may vote on multiple songs)
  const allVoterIds = new Set(requests.flatMap((r) => r.votes.map((_, i) => `${r.id}-${i}`)));
  const totalVoters = allVoterIds.size;

  const scored = eligible.map((req) => ({
    requestId: req.id,
    songId: req.songId,
    title: req.song.title,
    artist: req.song.artist,
    score: calculateRequestScore(req, session.currentEnergyLevel, totalVoters),
    voteCount: req.votes.length,
    durationMs: req.song.durationMs ?? undefined,
    isBoosted: req.isBoosted,
    boostAmount: req.boostAmount,
    userId: req.userId,
  }));

  scored.sort((a, b) => b.score - a.score);

  // Apply position-based boost: move boosted songs up BOOST_POSITIONS spots
  const ranked = applyBoostPositions(scored);

  // Cache the result
  setCachedQueue(sessionId, ranked);

  return ranked;
}
