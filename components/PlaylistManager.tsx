'use client';

import { useState, useCallback } from 'react';

interface StreamingPlaylist {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  trackCount: number;
}

interface Props {
  venueId: string;
  password: string;
  streamingService: string | null;
  youtubePlaylistId: string | null;
  onYoutubePlaylistChange: (id: string | null) => void;
}

export function PlaylistManager({
  venueId,
  password,
  streamingService,
  youtubePlaylistId,
  onYoutubePlaylistChange,
}: Props) {
  const [streamingPlaylists, setStreamingPlaylists] = useState<StreamingPlaylist[]>([]);
  const [showYoutubePicker, setShowYoutubePicker] = useState(false);
  const [selectedYoutubePlaylistName, setSelectedYoutubePlaylistName] = useState<string | null>(null);

  const loadStreamingPlaylists = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/${venueId}/streaming/playlists`, {
        headers: { 'x-admin-password': password },
      });
      if (res.ok) {
        const data = await res.json();
        setStreamingPlaylists(data.playlists ?? []);
      }
    } catch {
      // Ignore
    }
  }, [venueId, password]);

  const handleSelectYoutubePlaylist = (playlist: StreamingPlaylist) => {
    onYoutubePlaylistChange(playlist.id);
    setSelectedYoutubePlaylistName(playlist.name);
    setShowYoutubePicker(false);
  };

  if (streamingService !== 'youtube') {
    return null;
  }

  return (
    <div className="space-y-4">
      {/* YouTube Fallback Playlist */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-gray-300">Fallback Playlist</span>
          {youtubePlaylistId && (
            <button
              onClick={() => { onYoutubePlaylistChange(null); setSelectedYoutubePlaylistName(null); }}
              className="text-xs text-gray-500 hover:text-red-400 transition-colors"
            >
              Clear
            </button>
          )}
        </div>
        {youtubePlaylistId ? (
          <div className="flex items-center gap-2 bg-purple-900/30 border border-purple-700/50 rounded-lg p-2 text-xs">
            <span className="text-purple-300 shrink-0">▶</span>
            <span className="text-gray-200 truncate">{selectedYoutubePlaylistName ?? 'YouTube Playlist'}</span>
            <button
              onClick={() => {
                loadStreamingPlaylists();
                setShowYoutubePicker(true);
              }}
              className="text-xs text-purple-400 hover:text-purple-300 shrink-0 transition-colors"
            >
              Change
            </button>
          </div>
        ) : (
          <button
            onClick={() => {
              loadStreamingPlaylists();
              setShowYoutubePicker(true);
            }}
            className="w-full text-xs bg-red-700 hover:bg-red-600 text-white px-2 py-1.5 rounded transition-colors"
          >
            Select YouTube Playlist
          </button>
        )}
        <p className="text-xs text-gray-500">
          Plays from your YouTube playlist when the crowd queue is empty.
        </p>
      </div>

      {/* YouTube Playlist Picker Modal */}
      {showYoutubePicker && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowYoutubePicker(false)}>
          <div className="bg-gray-900 rounded-lg p-4 max-w-md w-full max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold mb-3">Select YouTube Playlist</h3>
            {streamingPlaylists.length === 0 ? (
              <p className="text-xs text-gray-400">Loading playlists...</p>
            ) : (
              <div className="space-y-2">
                {streamingPlaylists.map((pl) => (
                  <button
                    key={pl.id}
                    onClick={() => handleSelectYoutubePlaylist(pl)}
                    className={`w-full flex items-center gap-2 rounded p-2 text-left transition-colors ${
                      youtubePlaylistId === pl.id
                        ? 'bg-purple-900/40 border border-purple-700'
                        : 'bg-gray-800 hover:bg-gray-700'
                    }`}
                  >
                    {pl.imageUrl && (
                      <img src={pl.imageUrl} alt="" className="w-10 h-10 rounded object-cover" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{pl.name}</p>
                      <p className="text-xs text-gray-400">{pl.trackCount} tracks</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
            <button
              onClick={() => setShowYoutubePicker(false)}
              className="mt-3 text-xs text-gray-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
