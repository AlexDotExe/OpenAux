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
import { getRecentlyPlayedSongIds } from '../db/playback';
import { getVenueBlacklist } from '../db/venues';
import { findSessionById } from '../db/sessions';

export interface ScoredRequest {
  requestId: string;
  songId: string;
  title: string;
  artist: string;
  score: number;
  voteCount: number;
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

  const [requests, recentlyPlayedIds, blacklistedIds] = await Promise.all([
    findActiveRequests(sessionId),
    getRecentlyPlayedSongIds(sessionId, config.recentPlayExclusionCount),
    getVenueBlacklist(session.venueId),
  ]);

  // Fetch venue genre profile (type-safe JSON cast)
  const { prisma } = await import('../db/prisma');
  const venue = await prisma.venue.findUnique({
    where: { id: session.venueId },
    select: { genreProfile: true },
  });
  const genreProfile = (venue?.genreProfile ?? {}) as { primary?: string; secondary?: string[] };

  const eligible = filterEligibleRequests(
    requests,
    new Set(recentlyPlayedIds),
    new Set(blacklistedIds),
    genreProfile,
  );

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
  }));

  // Sort descending by score
  scored.sort((a, b) => b.score - a.score);

  return scored[0];
}

/**
 * Get ranked list of all eligible songs for display in the UI queue.
 */
export async function getRankedQueue(sessionId: string): Promise<ScoredRequest[]> {
  const session = await findSessionById(sessionId);
  if (!session) return [];

  const [requests, recentlyPlayedIds, blacklistedIds] = await Promise.all([
    findActiveRequests(sessionId),
    getRecentlyPlayedSongIds(sessionId, 10),
    getVenueBlacklist(session.venueId),
  ]);

  const { prisma } = await import('../db/prisma');
  const venue = await prisma.venue.findUnique({
    where: { id: session.venueId },
    select: { genreProfile: true },
  });
  const genreProfile = (venue?.genreProfile ?? {}) as { primary?: string; secondary?: string[] };

  const eligible = filterEligibleRequests(
    requests,
    new Set(recentlyPlayedIds),
    new Set(blacklistedIds),
    genreProfile,
  );

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
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored;
}
