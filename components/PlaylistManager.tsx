'use client';

import { useState, useEffect, useCallback } from 'react';

interface PlaylistSong {
  id: string;
  position: number;
  songId: string;
  song: {
    id: string;
    title: string;
    artist: string;
    albumArtUrl: string | null;
    durationMs: number | null;
    spotifyId: string | null;
    youtubeId: string | null;
  };
}

interface Playlist {
  id: string;
  name: string;
  createdAt: string;
  songs?: PlaylistSong[];
}

interface SearchResult {
  id?: string;
  serviceId?: string;
  title: string;
  artist: string;
  albumArtUrl?: string | null;
  durationMs?: number | null;
  spotifyId?: string | null;
  youtubeId?: string | null;
}

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
  activePlaylistId: string | null;
  playlistPriority: boolean;
  onSettingsChange: (activePlaylistId: string | null, playlistPriority: boolean) => void;
  streamingService: string | null;
  youtubePlaylistId: string | null;
  onYoutubePlaylistChange: (id: string | null) => void;
}

export function PlaylistManager({
  venueId,
  password,
  activePlaylistId,
  playlistPriority,
  onSettingsChange,
  streamingService,
  youtubePlaylistId,
  onYoutubePlaylistChange,
}: Props) {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [editName, setEditName] = useState('');
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [streamingPlaylists, setStreamingPlaylists] = useState<StreamingPlaylist[]>([]);
  const [importServiceName, setImportServiceName] = useState<string | null>(null);
  const [showingImport, setShowingImport] = useState(false);
  const [importing, setImporting] = useState(false);

  const loadPlaylists = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/${venueId}/playlists`, {
        headers: { 'x-admin-password': password },
      });
      if (res.ok) {
        const data = await res.json();
        setPlaylists(data.playlists ?? []);
      }
    } catch {
      // Ignore
    }
  }, [venueId, password]);

  useEffect(() => {
    loadPlaylists();
  }, [loadPlaylists]);

  const loadPlaylist = async (playlistId: string) => {
    try {
      const res = await fetch(`/api/admin/${venueId}/playlists/${playlistId}`, {
        headers: { 'x-admin-password': password },
      });
      if (res.ok) {
        const data = await res.json();
        setSelectedPlaylist(data.playlist);
      }
    } catch {
      // Ignore
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/${venueId}/playlists`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminPassword: password, name: newName.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setNewName('');
        setCreating(false);
        await loadPlaylists();
        await loadPlaylist(data.playlist.id);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (playlistId: string) => {
    if (!confirm('Delete this playlist? This cannot be undone.')) return;
    setLoading(true);
    try {
      await fetch(`/api/admin/${venueId}/playlists/${playlistId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminPassword: password }),
      });
      if (selectedPlaylist?.id === playlistId) setSelectedPlaylist(null);
      // If the deleted playlist was the active one, clear it
      if (activePlaylistId === playlistId) {
        onSettingsChange(null, playlistPriority);
      }
      await loadPlaylists();
    } finally {
      setLoading(false);
    }
  };

  const handleRename = async () => {
    if (!selectedPlaylist || !editName.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/${venueId}/playlists/${selectedPlaylist.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminPassword: password, name: editName.trim() }),
      });
      if (res.ok) {
        setEditingName(false);
        await loadPlaylists();
        await loadPlaylist(selectedPlaylist.id);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async (q: string) => {
    setSearchQuery(q);
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(`/api/songs/search?q=${encodeURIComponent(q)}&venueId=${venueId}`);
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data.results ?? []);
      }
    } finally {
      setSearching(false);
    }
  };

  const handleAddSong = async (result: SearchResult) => {
    if (!selectedPlaylist) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/${venueId}/playlists/${selectedPlaylist.id}/songs`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            adminPassword: password,
            song: {
              title: result.title,
              artist: result.artist,
              albumArtUrl: result.albumArtUrl ?? null,
              durationMs: result.durationMs ?? null,
              spotifyId: result.spotifyId ?? result.serviceId ?? null,
              youtubeId: result.youtubeId ?? null,
            },
          }),
        },
      );
      if (res.ok) {
        const data = await res.json();
        setSelectedPlaylist(data.playlist);
        setSearchQuery('');
        setSearchResults([]);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveSong = async (songId: string) => {
    if (!selectedPlaylist) return;
    setLoading(true);
    try {
      await fetch(
        `/api/admin/${venueId}/playlists/${selectedPlaylist.id}/songs/${songId}`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ adminPassword: password }),
        },
      );
      await loadPlaylist(selectedPlaylist.id);
    } finally {
      setLoading(false);
    }
  };

  const isActive = (playlistId: string) => activePlaylistId === playlistId;

  const handleSetActive = (playlistId: string | null) => {
    onSettingsChange(playlistId, playlistPriority);
  };

  const handleTogglePriority = () => {
    onSettingsChange(activePlaylistId, !playlistPriority);
  };

  const loadStreamingPlaylists = async () => {
    try {
      const res = await fetch(`/api/admin/${venueId}/streaming/playlists`, {
        headers: { 'x-admin-password': password },
      });
      if (res.ok) {
        const data = await res.json();
        setStreamingPlaylists(data.playlists ?? []);
        setImportServiceName(data.serviceName ?? null);
      }
    } catch {
      // Ignore
    }
  };

  const handleImportPlaylist = async (streamingPlaylistId: string) => {
    if (!selectedPlaylist) return;
    setImporting(true);
    try {
      const res = await fetch(
        `/api/admin/${venueId}/playlists/${selectedPlaylist.id}/import-streaming`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            adminPassword: password,
            streamingPlaylistId,
          }),
        }
      );
      if (res.ok) {
        const data = await res.json();
        setSelectedPlaylist(data.playlist);
        setShowingImport(false);
        // Successfully imported
      }
    } finally {
      setImporting(false);
    }
  };

  const formatDuration = (ms: number | null) => {
    if (!ms) return '';
    const secs = Math.round(ms / 1000);
    return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  };

  const [showYoutubePicker, setShowYoutubePicker] = useState(false);
  const [selectedYoutubePlaylistName, setSelectedYoutubePlaylistName] = useState<string | null>(null);

  const handleSelectYoutubePlaylist = (playlist: StreamingPlaylist) => {
    onYoutubePlaylistChange(playlist.id);
    setSelectedYoutubePlaylistName(playlist.name);
    setShowYoutubePicker(false);
  };

  return (
    <div className="space-y-4">
      {/* YouTube Fallback Playlist */}
      {streamingService === 'youtube' && (
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
      )}

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

      {/* Playlist List */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">{playlists.length} playlist{playlists.length !== 1 ? 's' : ''}</span>
        <button
          onClick={() => { setCreating(true); setNewName(''); }}
          className="text-xs bg-purple-700 hover:bg-purple-600 text-white px-2 py-1 rounded transition-colors"
        >
          + New
        </button>
      </div>

      {creating && (
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Playlist name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            className="flex-1 bg-gray-800 text-white rounded-lg px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-purple-500"
            autoFocus
          />
          <button
            onClick={handleCreate}
            disabled={loading || !newName.trim()}
            className="bg-purple-700 hover:bg-purple-600 disabled:opacity-40 text-white px-2 py-1 rounded text-xs transition-colors"
          >
            Create
          </button>
          <button
            onClick={() => setCreating(false)}
            className="bg-gray-800 hover:bg-gray-700 text-white px-2 py-1 rounded text-xs transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {playlists.length === 0 && !creating ? (
        <p className="text-gray-500 text-xs">No playlists yet. Create one to pre-load songs when a session starts.</p>
      ) : (
        <div className="space-y-1">
          {playlists.map((pl) => (
            <div
              key={pl.id}
              className={`flex items-center gap-2 rounded-lg p-2 text-xs cursor-pointer transition-colors ${
                selectedPlaylist?.id === pl.id
                  ? 'bg-purple-900/40 border border-purple-700'
                  : 'bg-gray-800 hover:bg-gray-700'
              }`}
              onClick={() => {
                if (selectedPlaylist?.id === pl.id) {
                  setSelectedPlaylist(null);
                } else {
                  loadPlaylist(pl.id);
                }
              }}
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{pl.name}</p>
              </div>
              {isActive(pl.id) && (
                <span className="bg-purple-700 text-white text-xs px-1.5 py-0.5 rounded-full shrink-0">
                  Active
                </span>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); handleSetActive(isActive(pl.id) ? null : pl.id); }}
                title={isActive(pl.id) ? 'Remove as startup playlist' : 'Set as startup playlist'}
                className={`text-xs px-2 py-0.5 rounded transition-colors shrink-0 ${
                  isActive(pl.id)
                    ? 'bg-purple-800 hover:bg-gray-700 text-purple-300'
                    : 'bg-gray-700 hover:bg-purple-700 text-gray-300'
                }`}
              >
                {isActive(pl.id) ? '★' : '☆'}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleDelete(pl.id); }}
                disabled={loading}
                title="Delete playlist"
                className="text-gray-500 hover:text-red-400 disabled:opacity-40 px-1 transition-colors shrink-0"
              >
                🗑
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Priority Toggle — shown when a startup playlist is selected */}
      {activePlaylistId && (
        <div className="bg-gray-800 rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium">Playlist Priority</label>
            <button
              onClick={handleTogglePriority}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                playlistPriority ? 'bg-purple-600' : 'bg-gray-700'
              }`}
            >
              <span
                className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                  playlistPriority ? 'translate-x-5' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
          <p className="text-xs text-gray-400">
            {playlistPriority
              ? 'Playlist songs play first before crowd requests'
              : 'Playlist songs mix with crowd requests by vote score'}
          </p>
        </div>
      )}

      {/* Selected Playlist Detail */}
      {selectedPlaylist && (
        <div className="border-t border-gray-800 pt-3 space-y-3">
          {/* Playlist header */}
          <div className="flex items-center gap-2">
            {editingName ? (
              <>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleRename()}
                  className="flex-1 bg-gray-800 text-white rounded px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-purple-500"
                  autoFocus
                />
                <button onClick={handleRename} disabled={loading} className="text-xs text-green-400 hover:text-green-300 transition-colors">
                  Save
                </button>
                <button onClick={() => setEditingName(false)} className="text-xs text-gray-400 hover:text-gray-300 transition-colors">
                  Cancel
                </button>
              </>
            ) : (
              <>
                <span className="text-sm font-semibold flex-1">{selectedPlaylist.name}</span>
                <button
                  onClick={() => { setEditingName(true); setEditName(selectedPlaylist.name); }}
                  className="text-xs text-gray-400 hover:text-gray-200 transition-colors"
                  title="Rename playlist"
                >
                  ✏️
                </button>
              </>
            )}
          </div>

          {/* Import button */}
          <button
            onClick={() => {
              loadStreamingPlaylists();
              setShowingImport(true);
            }}
            className="w-full text-xs bg-purple-700 hover:bg-purple-600 text-white px-2 py-1.5 rounded transition-colors"
          >
            Import Playlist
          </button>

          {/* Song search */}
          <div className="space-y-2">
            <input
              type="text"
              placeholder="Search songs to add…"
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              className="w-full bg-gray-800 text-white rounded-lg px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-purple-500"
            />
            {searching && <p className="text-xs text-gray-400">Searching…</p>}
            {searchResults.length > 0 && (
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {searchResults.map((result, idx) => {
                  const key = result.serviceId ?? result.spotifyId ?? result.youtubeId ?? result.id ?? `${result.title}-${result.artist}-${idx}`;
                  return (
                    <button
                      key={key}
                      onClick={() => handleAddSong(result)}
                      disabled={loading}
                      className="w-full flex items-center gap-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 rounded-lg p-2 text-left transition-colors"
                    >
                      {result.albumArtUrl && (
                        <img src={result.albumArtUrl} alt="" className="w-8 h-8 rounded object-cover shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{result.title}</p>
                        <p className="text-xs text-gray-400 truncate">{result.artist}</p>
                      </div>
                      <span className="text-xs text-purple-400 shrink-0">+ Add</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Songs in playlist */}
          {(selectedPlaylist.songs?.length ?? 0) === 0 ? (
            <p className="text-xs text-gray-500">No songs yet. Search above to add songs.</p>
          ) : (
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {selectedPlaylist.songs?.map((ps, idx) => (
                <div key={ps.id} className="flex items-center gap-2 bg-gray-800 rounded-lg p-2 text-xs">
                  <span className="text-gray-600 w-4 shrink-0">{idx + 1}</span>
                  {ps.song.albumArtUrl && (
                    <img src={ps.song.albumArtUrl} alt="" className="w-7 h-7 rounded object-cover shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{ps.song.title}</p>
                    <p className="text-gray-400 truncate">{ps.song.artist}</p>
                  </div>
                  {ps.song.durationMs && (
                    <span className="text-gray-500 shrink-0">{formatDuration(ps.song.durationMs)}</span>
                  )}
                  <button
                    onClick={() => handleRemoveSong(ps.songId)}
                    disabled={loading}
                    className="text-gray-500 hover:text-red-400 disabled:opacity-40 px-1 transition-colors shrink-0"
                    title="Remove from playlist"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Import Modal */}
      {showingImport && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowingImport(false)}>
          <div className="bg-gray-900 rounded-lg p-4 max-w-md w-full max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold mb-3">
              Import from {streamingService === 'spotify' ? 'Spotify' : streamingService === 'youtube' ? 'YouTube' : 'Streaming Service'}
            </h3>
            {streamingPlaylists.length === 0 ? (
              <p className="text-xs text-gray-400">Loading playlists...</p>
            ) : (
              <div className="space-y-2">
                {streamingPlaylists.map((pl) => (
                  <button
                    key={pl.id}
                    onClick={() => handleImportPlaylist(pl.id)}
                    disabled={importing}
                    className="w-full flex items-center gap-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 rounded p-2 text-left transition-colors"
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
              onClick={() => setShowingImport(false)}
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
