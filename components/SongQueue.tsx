'use client';

import { useSessionStore } from '@/lib/store/useSessionStore';

interface Song {
  requestId: string;
  songId: string;
  title: string;
  artist: string;
  score: number;
  voteCount: number;
  userVote?: 1 | -1;
}

interface Props {
  queue: Song[];
  onVote: (requestId: string, value: 1 | -1) => void;
}

export function SongQueue({ queue, onVote }: Props) {
  const { queue: storeQueue } = useSessionStore();
  const displayQueue = queue.length > 0 ? queue : storeQueue;

  if (displayQueue.length === 0) {
    return (
      <div className="bg-gray-900 rounded-xl p-4 text-center">
        <p className="text-gray-400">No songs in the queue yet.</p>
        <p className="text-gray-500 text-sm mt-1">Be the first to request one!</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h2 className="font-semibold">🎵 Song Queue</h2>
      {displayQueue.map((song, idx) => (
        <div
          key={song.requestId}
          className={`bg-gray-900 rounded-xl p-4 flex items-center gap-3 ${
            idx === 0 ? 'border border-purple-700' : ''
          }`}
        >
          {/* Position */}
          <span className="text-gray-600 font-mono text-sm w-5 shrink-0">
            {idx === 0 ? '▶' : `${idx + 1}`}
          </span>

          {/* Song info */}
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">{song.title}</p>
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
      ))}
    </div>
  );
}
