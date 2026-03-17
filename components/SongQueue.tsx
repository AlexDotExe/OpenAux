'use client';

import { useState } from 'react';
import { useSessionStore } from '@/lib/store/useSessionStore';

// Average pop/club song duration used when actual durationMs is not available in the database.
// Based on typical song lengths in bar/club settings (3-4 min range).
const DEFAULT_SONG_DURATION_MS = 3.5 * 60 * 1000;

interface Song {
  requestId: string;
  songId: string;
  title: string;
  artist: string;
  score: number;
  voteCount: number;
  durationMs?: number;
  userVote?: 1 | -1;
  isBoosted?: boolean;
  boostAmount?: number;
  userId?: string;
}

interface Props {
  queue: Song[];
  onVote: (requestId: string, value: 1 | -1) => void;
  currentUserId?: string;
  boostPrice?: number;
  monetizationEnabled?: boolean;
  nowPlayingRemainingMs?: number;
  onBoostSuccess?: () => void;
}

/**
 * Calculate estimated wait time in milliseconds for a song at the given queue index.
 * Index 0 = next song to play (waits for currently playing song to finish).
 * Index N = waits for N songs ahead of it plus the remaining time of the current song.
 */
function calculateWaitTimeMs(songs: Song[], index: number, nowPlayingRemainingMs: number): number {
  let waitMs = nowPlayingRemainingMs;
  for (let i = 0; i < index; i++) {
    waitMs += songs[i].durationMs ?? DEFAULT_SONG_DURATION_MS;
  }
  return waitMs;
}

function formatWaitTime(ms: number): string {
  const minutes = Math.round(ms / 60000);
  return minutes < 1 ? '< 1 min' : `~${minutes} min`;
}

export function SongQueue({ queue, onVote, currentUserId, boostPrice = 5.0, monetizationEnabled = false, nowPlayingRemainingMs = 0, onBoostSuccess }: Props) {
  const { queue: storeQueue } = useSessionStore();
  const displayQueue = queue.length > 0 ? queue : storeQueue;
  const [boostingRequestId, setBoostingRequestId] = useState<string | null>(null);
  const [showBoostModal, setShowBoostModal] = useState(false);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [boostStatus, setBoostStatus] = useState<string | null>(null);

  const handleBoostClick = (requestId: string) => {
    setSelectedRequestId(requestId);
    setShowBoostModal(true);
  };

  const confirmBoost = async () => {
    if (!selectedRequestId || !currentUserId) return;

    setBoostingRequestId(selectedRequestId);
    setBoostStatus(null);

    try {
      const res = await fetch(`/api/requests/${selectedRequestId}/boost`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUserId }),
      });

      const data = await res.json();

      if (res.ok) {
        setBoostStatus('Success! Your song has been boosted to the top!');
        setTimeout(() => {
          setShowBoostModal(false);
          setBoostStatus(null);
          if (onBoostSuccess) onBoostSuccess();
        }, 2000);
      } else {
        setBoostStatus(`Error: ${data.error}`);
      }
    } catch (err) {
      setBoostStatus('Failed to boost song. Please try again.');
    } finally {
      setBoostingRequestId(null);
    }
  };

  if (displayQueue.length === 0) {
    return (
      <div className="bg-gray-900 rounded-xl p-4 text-center">
        <p className="text-gray-400">No songs in the queue yet.</p>
        <p className="text-gray-500 text-sm mt-1">Be the first to request one!</p>
      </div>
    );
  }

  const canBoost = (song: Song) => {
    // Show boost button if user owns the song and it's not already boosted
    // Even show it when price is 0 (free) - button will show "FREE Boost"
    const result = (
      currentUserId &&
      song.userId === currentUserId &&
      !song.isBoosted
    );

    // Debug logging
    if (currentUserId && song.userId === currentUserId) {
      console.log('[SongQueue] Boost check for song:', {
        songTitle: song.title,
        monetizationEnabled,
        currentUserId,
        songUserId: song.userId,
        isBoosted: song.isBoosted,
        canBoost: result,
        boostPrice
      });
    }

    return result;
  };

  const isUserSong = (song: Song) => {
    return currentUserId && song.userId === currentUserId;
  };

  return (
    <>
      <div className="space-y-3">
        <h2 className="font-semibold">🎵 Song Queue</h2>
        {displayQueue.map((song, idx) => (
          <div key={song.requestId} className="space-y-2">
            {/* Queue Position Indicator - Only show for user's songs */}
            {isUserSong(song) && idx > 0 && (
              <div className="bg-blue-900/20 border border-blue-700 rounded-lg p-3 space-y-1">
                <p className="text-sm text-blue-300 text-center">
                  📍 {idx === 1 ? 'Next up!' : `${idx} songs ahead of yours`}
                </p>
                <p className="text-xs text-blue-400 text-center">
                  ⏱ Estimated play time: {formatWaitTime(calculateWaitTimeMs(displayQueue, idx, nowPlayingRemainingMs))}
                </p>
              </div>
            )}

            {/* Song Card */}
            <div
              className={`rounded-xl p-4 space-y-3 ${
                song.isBoosted
                  ? 'bg-yellow-900/20 border border-yellow-700'
                  : idx === 0
                  ? 'bg-gray-900 border border-green-700'
                  : isUserSong(song)
                  ? 'bg-gray-900 border border-blue-700'
                  : 'bg-gray-900'
              }`}
            >
              {/* Top row: Position, Song info, Vote buttons, Score */}
              <div className="flex items-center gap-3">
                {/* Position */}
                <span className="text-gray-600 font-mono text-sm w-5 shrink-0">
                  {song.isBoosted && '⚡'}
                  {idx === 0 ? '▶' : `${idx + 1}`}
                </span>

                {/* Song info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium truncate">{song.title}</p>
                    {song.isBoosted && (
                      <span className="text-xs bg-yellow-600 text-black px-2 py-0.5 rounded-full font-semibold shrink-0">
                        BOOSTED
                      </span>
                    )}
                  </div>
                  <p className="text-gray-400 text-sm truncate">{song.artist}</p>
                </div>

                {/* Vote buttons */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => onVote(song.requestId, 1)}
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm transition-colors ${
                      song.userVote === 1
                        ? 'bg-green-600 text-white'
                        : 'bg-gray-800 hover:bg-green-900 text-gray-400'
                    }`}
                  >
                    ↑
                  </button>
                  <span className="text-xs text-gray-400 w-4 text-center">{song.voteCount}</span>
                  <button
                    onClick={() => onVote(song.requestId, -1)}
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm transition-colors ${
                      song.userVote === -1
                        ? 'bg-red-600 text-white'
                        : 'bg-gray-800 hover:bg-red-900 text-gray-400'
                    }`}
                  >
                    ↓
                  </button>
                </div>

                {/* Score */}
                <div className="text-xs text-gray-500 shrink-0">{song.score.toFixed(1)}</div>
              </div>

              {/* Bottom row: Boost button (full width) */}
              {canBoost(song) && (() => {
                const currentWaitMs = calculateWaitTimeMs(displayQueue, idx, nowPlayingRemainingMs);
                const boostedWaitMs = calculateWaitTimeMs(displayQueue, 0, nowPlayingRemainingMs);
                const savingsMs = currentWaitMs - boostedWaitMs;
                return (
                  <div className="space-y-1">
                    <button
                      onClick={() => handleBoostClick(song.requestId)}
                      disabled={!!boostingRequestId}
                      className={`w-full text-sm font-semibold py-2 rounded-lg transition-colors ${
                        boostPrice === 0
                          ? 'bg-green-600 hover:bg-green-700 text-white'
                          : 'bg-yellow-600 hover:bg-yellow-700 text-black'
                      } disabled:opacity-40`}
                    >
                      ⚡ {boostPrice === 0 ? 'Boost to Top' : `Boost to Top - $${boostPrice.toFixed(2)}`}
                    </button>
                    {savingsMs > 0 && (
                      <p className="text-xs text-yellow-400 text-center">
                        Boost to save {formatWaitTime(savingsMs)}
                      </p>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        ))}
      </div>

      {/* Boost Confirmation Modal */}
      {showBoostModal && (() => {
        const selectedIdx = selectedRequestId ? displayQueue.findIndex(s => s.requestId === selectedRequestId) : -1;
        const savingsMs = selectedIdx > 0
          ? calculateWaitTimeMs(displayQueue, selectedIdx, nowPlayingRemainingMs) - calculateWaitTimeMs(displayQueue, 0, nowPlayingRemainingMs)
          : 0;
        return (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
            <div className="bg-gray-900 rounded-xl p-6 max-w-sm w-full space-y-4">
              <h3 className="text-xl font-bold">⚡ Boost Your Song</h3>
              {!boostStatus ? (
                <>
                  <p className="text-gray-400">
                    Boost this song to the top of the queue{boostPrice > 0 ? ` for $${boostPrice.toFixed(2)}` : ''}?
                  </p>
                  {savingsMs > 0 && (
                    <p className="text-sm text-yellow-400">
                      ⏱ Boost to save {formatWaitTime(savingsMs)}
                    </p>
                  )}
                  <p className="text-sm text-yellow-500">
                    Note: This is a fake payment for MVP demonstration
                  </p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setShowBoostModal(false)}
                      disabled={!!boostingRequestId}
                      className="flex-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-white py-2 rounded-lg font-semibold"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={confirmBoost}
                      disabled={!!boostingRequestId}
                      className="flex-1 bg-yellow-600 hover:bg-yellow-700 disabled:opacity-40 text-black py-2 rounded-lg font-semibold"
                    >
                      {boostingRequestId ? 'Boosting...' : 'Confirm Boost'}
                    </button>
                  </div>
                </>
              ) : (
                <div className="text-center">
                  <p className={boostStatus.startsWith('Error') ? 'text-red-400' : 'text-green-400'}>
                    {boostStatus}
                  </p>
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </>
  );
}
