/**
 * Playability layer + DJ brain (SPEC.md §1 layers 3 & 4 / §4 "DJ brain").
 *
 * Playability: does the top-ranked item actually play now? V0 = suggestion-mode approval
 * state + venue rules (an item can rank #1 and still fail).
 *
 * Selection: pick the highest-ranked playable item that also fits the vibe constraint
 * (avoid the same artist within the last N played). When no queue item is eligible, fall
 * back to the venue's fallback playlist — the room is never silent.
 *
 * Pure: callers pass the ranked items, recent artists, and fallback state.
 */

import type { QueueItem, QueueItemId, ScoringModel, VenueControlMode } from '@openaux/shared';
import { ARTIST_REPEAT_WINDOW } from './constants.js';
import { passesMinVoteGate, type ActiveUserGate } from './playability.js';

export interface PlayabilityContext {
  controlMode: VenueControlMode;
  /** Activates the min-vote gate below when `'v1'`. Omitted/`'v0'` = no gate. */
  scoringModel?: ScoringModel;
}

/**
 * V0/V1 playability gate. An item is playable when it is still queued and its
 * playability_state is `playable` (in suggestion mode, unapproved items sit at
 * `awaiting_approval`; V1 gates hold items at `held`). On `scoringModel: 'v1'`, an
 * item additionally has to clear the min-vote gate (SPEC.md §4) once `gate` (the
 * venue's live active-user count) is supplied.
 */
export function isPlayable(
  item: QueueItem,
  context: PlayabilityContext,
  gate?: ActiveUserGate | null,
): boolean {
  if (item.status !== 'queued') return false;
  if (item.playabilityState !== 'playable') return false;
  if (context.scoringModel === 'v1' && gate) {
    return passesMinVoteGate({
      upvotesCount: item.upvotesCount,
      downvotesCount: item.downvotesCount,
      gate,
    });
  }
  return true;
}

function normalizeArtist(artist: string): string {
  return artist.trim().toLowerCase();
}

/**
 * The vibe constraint: an item passes when its artist is not among the last
 * ARTIST_REPEAT_WINDOW played artists.
 */
export function passesArtistConstraint(item: QueueItem, recentArtists: string[]): boolean {
  const recent = new Set(recentArtists.slice(0, ARTIST_REPEAT_WINDOW).map(normalizeArtist));
  return !recent.has(normalizeArtist(item.artist));
}

export type NextSelection =
  | { kind: 'queue_item'; item: QueueItem; artistConstraintRelaxed: boolean; forced: boolean }
  | { kind: 'fallback'; providerTrackId: string; cursor: number }
  | { kind: 'silent' };

export interface SelectNextInput {
  /** Items already ranked best-first (from rankItems). */
  rankedItems: QueueItem[];
  /** Artists of the last few played songs, most-recent first. */
  recentArtists: string[];
  context: PlayabilityContext;
  /** Ordered provider track ids for the silence fallback. */
  fallbackPlaylist: string[];
  /** Rotation cursor for the fallback playlist (e.g. count of songs already played). */
  fallbackCursor: number;
  /**
   * Venue-override forced pick (overrides layer, `QueueService.playNext`). When set and
   * still among `rankedItems` and playable, it is selected ahead of ranking and the vibe
   * constraint entirely — overrides are deliberate. Falls through to normal selection if
   * the item is gone or no longer playable (e.g. it was removed or blocked meanwhile).
   * The caller owns clearing the persisted marker; this function only reads it.
   */
  forcedItemId?: QueueItemId | null;
  /** Venue's live active-user count for the min-vote gate (`context.scoringModel: 'v1'`
   * only; ignored otherwise). Null/omitted when the venue is off V1 or has no sessions. */
  gate?: ActiveUserGate | null;
}

/**
 * DJ-brain selection:
 *  1. If a venue override forced a specific item next and it is still playable, take it —
 *     bypassing both rank and the vibe constraint (overrides layer, deliberate).
 *  2. Prefer the top-ranked playable item whose artist clears the vibe constraint.
 *  3. If every playable item repeats a recent artist, relax the constraint and take the
 *     top-ranked playable item (flagged) — better a slight repeat than silence.
 *  4. If nothing is playable, rotate into the fallback playlist.
 *  5. If the fallback playlist is empty too, report silence so callers can react.
 */
export function selectNextTrack(input: SelectNextInput): NextSelection {
  if (input.forcedItemId) {
    const forced = input.rankedItems.find((item) => item.queueItemId === input.forcedItemId);
    if (forced && isPlayable(forced, input.context, input.gate)) {
      return { kind: 'queue_item', item: forced, artistConstraintRelaxed: false, forced: true };
    }
  }

  const playable = input.rankedItems.filter((item) => isPlayable(item, input.context, input.gate));

  const preferred = playable.find((item) => passesArtistConstraint(item, input.recentArtists));
  if (preferred) {
    return { kind: 'queue_item', item: preferred, artistConstraintRelaxed: false, forced: false };
  }

  const first = playable[0];
  if (first) {
    return { kind: 'queue_item', item: first, artistConstraintRelaxed: true, forced: false };
  }

  if (input.fallbackPlaylist.length > 0) {
    const index =
      ((input.fallbackCursor % input.fallbackPlaylist.length) + input.fallbackPlaylist.length) %
      input.fallbackPlaylist.length;
    // Length checked above; index is in range.
    const providerTrackId = input.fallbackPlaylist[index] as string;
    return { kind: 'fallback', providerTrackId, cursor: index };
  }

  return { kind: 'silent' };
}
