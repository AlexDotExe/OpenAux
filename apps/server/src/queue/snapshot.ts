/**
 * Queue snapshot + position/ETA/boost-preview (SPEC.md §1 layer 2; contracts
 * QueueSnapshot & QueuePositionResponse). Pure — callers pass ranked items in.
 */

import type {
  QueueItem,
  QueueItemId,
  QueuePositionResponse,
  QueueSnapshot,
  ScoringWeights,
} from '@openaux/shared';
import { DEFAULT_AVG_TRACK_MINUTES, UP_NEXT_SIZE } from './constants.js';
import { rankItems } from './ranking.js';
import type { FrictionInputs } from './seams.js';

/** Fisher–Yates shuffle using an injectable RNG (default Math.random). */
export function shuffle<T>(items: T[], rng: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = out[i] as T;
    const b = out[j] as T;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

export interface BuildSnapshotInput {
  nowPlaying: QueueItem | null;
  /** Queued items, already ranked best-first. */
  rankedQueued: QueueItem[];
  /** Injectable shuffle for the pre-shuffled `rest`; default randomizes. */
  shuffleFn?: (items: QueueItem[]) => QueueItem[];
}

/**
 * Split the live queue into nowPlaying / upNext (top 3 by rank) / rest (pre-shuffled).
 */
export function buildQueueSnapshot(input: BuildSnapshotInput): QueueSnapshot {
  const upNext = input.rankedQueued.slice(0, UP_NEXT_SIZE);
  const restOrdered = input.rankedQueued.slice(UP_NEXT_SIZE);
  const shuffleFn = input.shuffleFn ?? ((items: QueueItem[]) => shuffle(items));
  return {
    nowPlaying: input.nowPlaying,
    upNext,
    rest: shuffleFn(restOrdered),
  };
}

/**
 * 1-based position of an item in the live queue. nowPlaying = 0; the first Up Next
 * item = 1. Returns null if the item is neither playing nor queued.
 */
export function computeQueuePosition(
  queueItemId: QueueItemId,
  rankedQueued: QueueItem[],
  nowPlaying: QueueItem | null,
): number | null {
  if (nowPlaying !== null && nowPlaying.queueItemId === queueItemId) return 0;
  const idx = rankedQueued.findIndex((item) => item.queueItemId === queueItemId);
  return idx === -1 ? null : idx + 1;
}

/** ETA from queue position × average track length (SPEC.md §5 monetization UI). */
export function estimateMinutesUntilPlay(
  position: number,
  avgTrackMinutes: number = DEFAULT_AVG_TRACK_MINUTES,
): number {
  return Math.max(0, position) * avgTrackMinutes;
}

export interface BoostPreviewInput {
  target: QueueItem;
  /** Queued items (must include target), already ranked. */
  rankedQueued: QueueItem[];
  weights: ScoringWeights;
  frictionByItem?: Map<QueueItemId, FrictionInputs>;
}

/**
 * Positions the target would gain from one more Priority Boost, computed by re-ranking
 * a simulated copy through the shared engine. Never negative.
 */
export function computeBoostPreviewPositions(input: BoostPreviewInput): number {
  const currentIdx = input.rankedQueued.findIndex(
    (item) => item.queueItemId === input.target.queueItemId,
  );
  if (currentIdx === -1) return 0;

  const simulated = input.rankedQueued.map((item) =>
    item.queueItemId === input.target.queueItemId
      ? { ...item, priorityBoostCount: item.priorityBoostCount + 1 }
      : item,
  );
  const reranked = rankItems(simulated, input.weights, input.frictionByItem);
  const newIdx = reranked.findIndex((item) => item.queueItemId === input.target.queueItemId);
  return Math.max(0, currentIdx - newIdx);
}

export interface PositionResponseInput extends BoostPreviewInput {
  nowPlaying: QueueItem | null;
  avgTrackMinutes?: number;
}

/** Assemble the full QueuePositionResponse contract shape. */
export function buildPositionResponse(input: PositionResponseInput): QueuePositionResponse | null {
  const position = computeQueuePosition(
    input.target.queueItemId,
    input.rankedQueued,
    input.nowPlaying,
  );
  if (position === null) return null;
  return {
    position,
    estimatedMinutesUntilPlay: estimateMinutesUntilPlay(position, input.avgTrackMinutes),
    boostPreviewPositions: computeBoostPreviewPositions(input),
  };
}
