'use client';

interface SearchResultItem {
  // Streaming service result
  serviceId?: string;
  service?: 'spotify' | 'youtube';
  source?: 'itunes';
  // Local DB result
  id?: string;
  spotifyId?: string | null;
  youtubeId?: string | null;
  // Common
  title: string;
  artist: string;
  albumArtUrl?: string | null;
  durationMs?: number | null;
}

interface Props {
  results: SearchResultItem[];
  onSelect: (result: SearchResultItem) => void;
  loading?: boolean;
}

function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function SongSearchResults({ results, onSelect, loading }: Props) {
  if (loading) {
    return (
      <div className="bg-gray-800 rounded-lg p-3 text-center">
        <p className="text-gray-400 text-sm animate-pulse">Searching...</p>
      </div>
    );
  }

  if (results.length === 0) return null;

  return (
    <div className="bg-gray-800 rounded-lg max-h-64 overflow-y-auto">
      {results.map((result, idx) => {
        const key = result.serviceId ?? result.id ?? `${idx}`;
        const isSpotify = result.service === 'spotify' || !!result.spotifyId;
        const isYoutube = result.service === 'youtube' || !!result.youtubeId;

        return (
          <button
            key={key}
            onClick={() => onSelect(result)}
            className="w-full flex items-center gap-3 p-3 hover:bg-gray-700 transition-colors text-left border-b border-gray-700 last:border-b-0"
          >
            {/* Album art */}
            {result.albumArtUrl ? (
              <img
                src={result.albumArtUrl}
                alt=""
                className="w-10 h-10 rounded object-cover flex-shrink-0"
              />
            ) : (
              <div className="w-10 h-10 rounded bg-gray-600 flex items-center justify-center flex-shrink-0">
                <span className="text-gray-400 text-xs">♪</span>
              </div>
            )}

            {/* Song info */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{result.title}</p>
              <p className="text-xs text-gray-400 truncate">{result.artist}</p>
            </div>

            {/* Duration + service icon */}
            <div className="flex items-center gap-2 flex-shrink-0">
              {result.durationMs && (
                <span className="text-xs text-gray-500">{formatDuration(result.durationMs)}</span>
              )}
              {isSpotify && <span className="text-xs text-green-400">●</span>}
              {isYoutube && <span className="text-xs text-red-400">▶</span>}
            </div>
          </button>
        );
      })}
    </div>
  );
}
