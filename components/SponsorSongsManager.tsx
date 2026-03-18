'use client';

import { useState, useEffect, useCallback } from 'react';

interface SponsorSongEntry {
  id: string;
  songId: string;
  promotionText: string | null;
  promotionDurationMinutes: number;
  isActive: boolean;
  isAnthem: boolean;
  activationCount: number;
  promotionActivatedAt: string | null;
  promotionExpiresAt: string | null;
  song: {
    id: string;
    title: string;
    artist: string;
    albumArtUrl: string | null;
  };
}

interface SponsorSongsManagerProps {
  venueId: string;
  password: string;
  loading: boolean;
}

export function SponsorSongsManager({ venueId, password, loading: parentLoading }: SponsorSongsManagerProps) {
  const [sponsorSongs, setSponsorSongs] = useState<SponsorSongEntry[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [adding, setAdding] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  // New song form state
  const [newTitle, setNewTitle] = useState('');
  const [newArtist, setNewArtist] = useState('');
  const [newSpotifyId, setNewSpotifyId] = useState('');
  const [newPromoText, setNewPromoText] = useState('');
  const [newDuration, setNewDuration] = useState(5);
  const [newIsAnthem, setNewIsAnthem] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);

  const loadSponsorSongs = useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await fetch(`/api/admin/${venueId}/sponsor-songs?adminPassword=${encodeURIComponent(password)}`);
      if (res.ok) {
        const data = await res.json();
        setSponsorSongs(data.sponsorSongs ?? []);
      }
    } catch (err) {
      console.error('Failed to load sponsor songs:', err);
    } finally {
      setLoadingList(false);
    }
  }, [venueId, password]);

  useEffect(() => {
    if (password) loadSponsorSongs();
  }, [loadSponsorSongs, password]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newArtist.trim()) return;
    setAdding(true);
    setSaveStatus(null);
    try {
      const res = await fetch(`/api/admin/${venueId}/sponsor-songs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminPassword: password,
          title: newTitle.trim(),
          artist: newArtist.trim(),
          spotifyId: newSpotifyId.trim() || undefined,
          promotionText: newPromoText.trim() || undefined,
          promotionDurationMinutes: newDuration,
          isAnthem: newIsAnthem,
        }),
      });
      if (res.ok) {
        setSaveStatus('Sponsor song added!');
        setNewTitle('');
        setNewArtist('');
        setNewSpotifyId('');
        setNewPromoText('');
        setNewDuration(5);
        setNewIsAnthem(false);
        setShowAddForm(false);
        await loadSponsorSongs();
      } else {
        const data = await res.json();
        setSaveStatus(`Error: ${data.error}`);
      }
    } catch (err) {
      console.error('Failed to add sponsor song:', err);
      setSaveStatus('Failed to add sponsor song');
    } finally {
      setAdding(false);
      setTimeout(() => setSaveStatus(null), 4000);
    }
  };

  const handleToggleActive = async (entry: SponsorSongEntry) => {
    try {
      await fetch(`/api/admin/${venueId}/sponsor-songs/${entry.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminPassword: password, isActive: !entry.isActive }),
      });
      await loadSponsorSongs();
    } catch (err) {
      console.error('Failed to toggle sponsor song:', err);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remove this sponsor song?')) return;
    try {
      await fetch(`/api/admin/${venueId}/sponsor-songs/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminPassword: password }),
      });
      await loadSponsorSongs();
    } catch (err) {
      console.error('Failed to delete sponsor song:', err);
    }
  };

  const isPromotionLive = (entry: SponsorSongEntry) => {
    if (!entry.promotionExpiresAt) return false;
    return new Date(entry.promotionExpiresAt) > new Date();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-400">
          🍹 Sponsor Songs
          {sponsorSongs.length > 0 && (
            <span className="ml-2 bg-amber-700 text-white text-xs px-1.5 py-0.5 rounded-full">
              {sponsorSongs.length}
            </span>
          )}
        </h3>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="text-xs text-amber-400 hover:text-amber-300 transition-colors"
        >
          {showAddForm ? 'Cancel' : '+ Add'}
        </button>
      </div>

      {saveStatus && (
        <div className="text-xs bg-gray-800 rounded-lg p-2">{saveStatus}</div>
      )}

      {/* Add Form */}
      {showAddForm && (
        <form onSubmit={handleAdd} className="space-y-2 bg-gray-800 rounded-lg p-3">
          <p className="text-xs font-semibold text-amber-300">New Sponsor Song</p>
          <input
            type="text"
            placeholder="Song title *"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            required
            className="w-full bg-gray-700 text-white rounded px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-amber-500 placeholder-gray-500"
          />
          <input
            type="text"
            placeholder="Artist *"
            value={newArtist}
            onChange={(e) => setNewArtist(e.target.value)}
            required
            className="w-full bg-gray-700 text-white rounded px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-amber-500 placeholder-gray-500"
          />
          <input
            type="text"
            placeholder="Spotify track ID (optional)"
            value={newSpotifyId}
            onChange={(e) => setNewSpotifyId(e.target.value)}
            className="w-full bg-gray-700 text-white rounded px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-amber-500 placeholder-gray-500"
          />
          <input
            type="text"
            placeholder='Promotion text, e.g. "$2 off tequila shots"'
            value={newPromoText}
            onChange={(e) => setNewPromoText(e.target.value)}
            className="w-full bg-gray-700 text-white rounded px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-amber-500 placeholder-gray-500"
          />
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400 flex-1">Promo duration (min)</label>
            <input
              type="number"
              min={1}
              max={60}
              value={newDuration}
              onChange={(e) => setNewDuration(parseInt(e.target.value) || 5)}
              className="w-16 bg-gray-700 text-white rounded px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-amber-500"
            />
          </div>
          <div className="flex items-center justify-between">
            <label className="text-xs text-gray-400">Mark as Venue Anthem</label>
            <button
              type="button"
              onClick={() => setNewIsAnthem(!newIsAnthem)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                newIsAnthem ? 'bg-amber-600' : 'bg-gray-700'
              }`}
            >
              <span
                className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                  newIsAnthem ? 'translate-x-5' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
          <button
            type="submit"
            disabled={adding || parentLoading || !newTitle.trim() || !newArtist.trim()}
            className="w-full bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white text-xs font-semibold py-1.5 rounded transition-colors"
          >
            {adding ? 'Adding...' : 'Add Sponsor Song'}
          </button>
        </form>
      )}

      {/* List */}
      {loadingList ? (
        <p className="text-gray-500 text-xs">Loading...</p>
      ) : sponsorSongs.length === 0 ? (
        <p className="text-gray-500 text-xs">
          No sponsor songs yet. Add songs to link drink specials to crowd requests.
        </p>
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {sponsorSongs.map((entry) => {
            const live = isPromotionLive(entry);
            return (
              <div
                key={entry.id}
                className={`rounded-lg p-2 text-xs ${
                  live
                    ? 'bg-amber-900/40 border border-amber-600'
                    : 'bg-gray-800'
                }`}
              >
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      {entry.isAnthem && <span title="Venue Anthem">🎙️</span>}
                      {live && <span title="Promotion active">🍹</span>}
                      <p className="font-medium truncate">{entry.song.title}</p>
                    </div>
                    <p className="text-gray-400 truncate">{entry.song.artist}</p>
                    {entry.promotionText && (
                      <p className="text-amber-300 mt-0.5 truncate">{entry.promotionText}</p>
                    )}
                    <p className="text-gray-500 mt-0.5">
                      {entry.promotionDurationMinutes} min · {entry.activationCount} activation{entry.activationCount !== 1 ? 's' : ''}
                    </p>
                    {live && entry.promotionExpiresAt && (
                      <p className="text-amber-400 font-semibold mt-0.5">
                        🔥 LIVE — expires {new Date(entry.promotionExpiresAt).toLocaleTimeString()}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    <button
                      onClick={() => handleToggleActive(entry)}
                      className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                        entry.isActive
                          ? 'bg-green-800 hover:bg-green-700 text-green-300'
                          : 'bg-gray-700 hover:bg-gray-600 text-gray-400'
                      }`}
                      title={entry.isActive ? 'Click to deactivate' : 'Click to activate'}
                    >
                      {entry.isActive ? 'On' : 'Off'}
                    </button>
                    <button
                      onClick={() => handleDelete(entry.id)}
                      className="bg-gray-700 hover:bg-red-900 px-2 py-1 rounded text-xs transition-colors"
                      title="Remove"
                    >
                      🗑
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
