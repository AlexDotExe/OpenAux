/**
 * FrictionProvider — the antispam-layer input to the scoring engine
 * (packages/shared/src/scoring/index.ts ScoringInputs.artistRepeatPenalty / spamPenalty).
 *
 * SPEC.md §4: FrictionScore = ArtistRepeatPenalty + SpamPenalty.
 * SPEC.md §1 layer 1 / §5: same-artist repeat suppression, rapid-fire vote spam.
 *
 * Decision math is pure and unit-tested; repository interfaces keep DB access
 * behind a seam so callers can stub them without a live database.
 */

export const DEFAULT_ARTIST_REPEAT_LOOKBACK_TRACKS = 5;
export const DEFAULT_ARTIST_REPEAT_PENALTY = 2;

export const DEFAULT_SPAM_VOTE_WINDOW_MINUTES = 10;
/** Rapid-fire voting: more than this many votes per user per window trips the penalty. */
export const DEFAULT_SPAM_VOTE_THRESHOLD = 3;
export const DEFAULT_SPAM_PENALTY_PER_OFFENDER = 1;

export interface FrictionConfig {
  /** How many recently-played tracks count as "recent" for the artist-repeat check. */
  artistRepeatLookbackTracks: number;
  artistRepeatPenalty: number;
  spamVoteWindowMinutes: number;
  spamVoteThreshold: number;
  spamPenaltyPerOffender: number;
}

export const DEFAULT_FRICTION_CONFIG: FrictionConfig = {
  artistRepeatLookbackTracks: DEFAULT_ARTIST_REPEAT_LOOKBACK_TRACKS,
  artistRepeatPenalty: DEFAULT_ARTIST_REPEAT_PENALTY,
  spamVoteWindowMinutes: DEFAULT_SPAM_VOTE_WINDOW_MINUTES,
  spamVoteThreshold: DEFAULT_SPAM_VOTE_THRESHOLD,
  spamPenaltyPerOffender: DEFAULT_SPAM_PENALTY_PER_OFFENDER,
};

// ---------------------------------------------------------------------------
// Pure decision functions
// ---------------------------------------------------------------------------

/**
 * Same artist played/queued within the last N tracks → flat penalty.
 * `recentArtists` is newest-first and already trimmed to the lookback window.
 */
export function computeArtistRepeatPenalty(
  recentArtists: readonly string[],
  artist: string,
  penalty: number = DEFAULT_ARTIST_REPEAT_PENALTY,
): number {
  return recentArtists.includes(artist) ? penalty : 0;
}

/**
 * One penalty per offending supporter: a supporter who cast more than
 * `threshold` votes within the spam window contributes `penaltyPerOffender`.
 */
export function computeSpamPenalty(
  voteCountsByUserId: ReadonlyMap<string, number> | Readonly<Record<string, number>>,
  threshold: number = DEFAULT_SPAM_VOTE_THRESHOLD,
  penaltyPerOffender: number = DEFAULT_SPAM_PENALTY_PER_OFFENDER,
): number {
  const counts =
    voteCountsByUserId instanceof Map
      ? [...voteCountsByUserId.values()]
      : Object.values(voteCountsByUserId);
  const offenders = counts.filter((count) => count > threshold).length;
  return offenders * penaltyPerOffender;
}

// ---------------------------------------------------------------------------
// Repository interfaces (implemented against the shared pool by callers)
// ---------------------------------------------------------------------------

export interface RecentlyPlayedArtistsRepository {
  /** Most-recently-played artist names at the venue, newest first, capped to `limit`. */
  getRecentArtists(venueId: string, limit: number): Promise<string[]>;
}

export interface VoteActivityRepository {
  /** Vote counts since `since` for the given users at the venue, keyed by user id. */
  getVoteCountsSince(
    venueId: string,
    userIds: readonly string[],
    since: Date,
  ): Promise<Map<string, number>>;
}

export interface FrictionProviderDeps {
  recentArtistsRepository: RecentlyPlayedArtistsRepository;
  voteActivityRepository: VoteActivityRepository;
}

// ---------------------------------------------------------------------------
// FrictionProvider
// ---------------------------------------------------------------------------

export interface FrictionQueueItemInput {
  venueId: string;
  artist: string;
  /** User ids currently supporting (voted up on / requested) this item. */
  supporterUserIds: readonly string[];
}

export interface FrictionScores {
  artistRepeatPenalty: number;
  spamPenalty: number;
}

/** What WS3's ranking loop calls once per queue item to get friction inputs. */
export interface FrictionProvider {
  getFriction(item: FrictionQueueItemInput, now?: Date): Promise<FrictionScores>;
}

export function createFrictionProvider(
  deps: FrictionProviderDeps,
  config: FrictionConfig = DEFAULT_FRICTION_CONFIG,
): FrictionProvider {
  return {
    async getFriction(item, now = new Date()): Promise<FrictionScores> {
      const since = new Date(now.getTime() - config.spamVoteWindowMinutes * 60 * 1000);
      const [recentArtists, voteCounts] = await Promise.all([
        deps.recentArtistsRepository.getRecentArtists(
          item.venueId,
          config.artistRepeatLookbackTracks,
        ),
        item.supporterUserIds.length > 0
          ? deps.voteActivityRepository.getVoteCountsSince(
              item.venueId,
              item.supporterUserIds,
              since,
            )
          : Promise.resolve(new Map<string, number>()),
      ]);

      return {
        artistRepeatPenalty: computeArtistRepeatPenalty(
          recentArtists,
          item.artist,
          config.artistRepeatPenalty,
        ),
        spamPenalty: computeSpamPenalty(
          voteCounts,
          config.spamVoteThreshold,
          config.spamPenaltyPerOffender,
        ),
      };
    },
  };
}
