'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';
import { PlaylistManager } from './PlaylistManager';
import { SponsorSongsManager } from './SponsorSongsManager';
import type { PendingSuggestion } from '@/app/admin/[venueId]/page';

interface SponsorSong {
  id: string;
  songId: string;
  promotionText: string | null;
  isAnthem: boolean;
  song: {
    title: string;
    artist: string;
  };
}

interface Props {
  venueId: string;
  password: string;
  origin: string;
  streamingService: string | null;
  isConnected: boolean;
  connectedAccountName?: string | null;
  connectedAccountEmail?: string | null;
  activeSession: boolean;
  sessionId: string | null;
  loading: boolean;
  onDisconnect: () => void;
  onSessionStart: () => void;
  onSessionEnd: () => void;
  // Venue Settings
  defaultBoostPrice: number;
  setDefaultBoostPrice: (val: number) => void;
  maxSongRepeatsPerHour: number;
  setMaxSongRepeatsPerHour: (val: number) => void;
  maxSongsPerUser: number;
  setMaxSongsPerUser: (val: number) => void;
  monetizationEnabled: boolean;
  setMonetizationEnabled: (val: boolean) => void;
  smartMonetizationEnabled: boolean;
  setSmartMonetizationEnabled: (val: boolean) => void;
  suggestionModeEnabled: boolean;
  setSuggestionModeEnabled: (val: boolean) => void;
  crowdControlEnabled: boolean;
  setCrowdControlEnabled: (val: boolean) => void;
  onSaveSettings: () => void;
  settingsSaveStatus: string | null;
  // Playlist settings
  youtubePlaylistId: string | null;
  onYoutubePlaylistChange: (id: string | null) => void;
  // Active Users
  userCount: number;
  simulatedUsers: number;
  onSimulatedUsersChange: (count: number) => void;
  smartSettings?: {
    boostPrice: number;
    maxSongsPerUser: number;
    maxSongRepeatsPerHour: number;
  } | null;
  // Pending Suggestions
  pendingSuggestions: PendingSuggestion[];
  onApproveSuggestion: (requestId: string) => void;
  onRejectSuggestion: (requestId: string) => void;
  onBulkAction: (action: 'approve' | 'reject', requestIds: string[]) => void;
  // YouTube Player (track info only)
  currentTrackInfo?: { title: string; artist: string; source: 'queue' | 'playlist' } | null;
}

type AdminTab = 'account' | 'venue' | 'session';

export function AdminControlPanel({
  venueId,
  password,
  origin,
  streamingService,
  isConnected,
  connectedAccountName,
  connectedAccountEmail,
  activeSession,
  sessionId,
  loading,
  onDisconnect,
  onSessionStart,
  onSessionEnd,
  defaultBoostPrice,
  setDefaultBoostPrice,
  maxSongRepeatsPerHour,
  setMaxSongRepeatsPerHour,
  maxSongsPerUser,
  setMaxSongsPerUser,
  monetizationEnabled,
  setMonetizationEnabled,
  smartMonetizationEnabled,
  setSmartMonetizationEnabled,
  suggestionModeEnabled,
  setSuggestionModeEnabled,
  crowdControlEnabled,
  setCrowdControlEnabled,
  onSaveSettings,
  settingsSaveStatus,
  youtubePlaylistId,
  onYoutubePlaylistChange,
  userCount,
  simulatedUsers,
  onSimulatedUsersChange,
  smartSettings,
  pendingSuggestions,
  onApproveSuggestion,
  onRejectSuggestion,
  onBulkAction,
  currentTrackInfo,
}: Props) {
  const [activeTab, setActiveTab] = useState<AdminTab>('session');
  const [settingsExpanded, setSettingsExpanded] = useState(false);

  // Sponsor songs state
  const [sponsorSongs, setSponsorSongs] = useState<SponsorSong[]>([]);
  const [sponsorSongsLoading, setSponsorSongsLoading] = useState(false);
  const [sponsorSongForm, setSponsorSongForm] = useState({
    songId: '',
    promotionText: '',
    isAnthem: false,
  });
  const [sponsorSongStatus, setSponsorSongStatus] = useState<string | null>(null);

  const fetchSponsorSongs = useCallback(async () => {
    setSponsorSongsLoading(true);
    try {
      const res = await fetch(`/api/admin/${venueId}/sponsor-songs`, {
        headers: { 'x-admin-password': password },
      });
      if (res.ok) {
        const data = await res.json();
        setSponsorSongs(data.sponsorSongs ?? []);
      }
    } catch {
      // Ignore
    } finally {
      setSponsorSongsLoading(false);
    }
  }, [venueId, password]);

  const handleAddSponsorSong = async () => {
    if (!sponsorSongForm.songId.trim()) return;
    setSponsorSongStatus(null);
    try {
      const res = await fetch(`/api/admin/${venueId}/sponsor-songs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminPassword: password,
          songId: sponsorSongForm.songId.trim(),
          promotionText: sponsorSongForm.promotionText.trim() || null,
          isAnthem: sponsorSongForm.isAnthem,
        }),
      });
      if (res.ok) {
        setSponsorSongStatus('Song added!');
        setSponsorSongForm({ songId: '', promotionText: '', isAnthem: false });
        await fetchSponsorSongs();
        setTimeout(() => setSponsorSongStatus(null), 3000);
      } else {
        const data = await res.json();
        setSponsorSongStatus(`Error: ${data.error}`);
      }
    } catch {
      setSponsorSongStatus('Failed to add sponsor song');
    }
  };

  const handleRemoveSponsorSong = async (songId: string) => {
    try {
      await fetch(`/api/admin/${venueId}/sponsor-songs`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminPassword: password, songId }),
      });
      await fetchSponsorSongs();
    } catch {
      // Ignore
    }
  };

  useEffect(() => {
    fetchSponsorSongs();
  }, [fetchSponsorSongs]);

  const handleDisconnect = async () => {
    await fetch(`/api/admin/${venueId}/disconnect`, {
      method: 'POST',
      headers: { 'x-admin-password': password },
    });
    onDisconnect();
  };

  const handleConnect = async (provider: 'spotify' | 'youtube') => {
    const res = await fetch(`/api/admin/${venueId}/connect/${provider}`, {
      headers: { 'x-admin-password': password },
    });
    if (!res.ok) return;

    const data = await res.json();
    if (data.url) {
      window.location.assign(data.url);
    }
  };

  return (
    <div className="bg-gray-900 rounded-xl p-4 space-y-4">
      <h2 className="font-semibold text-lg">Control Panel</h2>

      {/* Tab Navigation */}
      <div className="flex gap-2 border-b border-gray-800 pb-3">
        <button
          onClick={() => setActiveTab('session')}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
            activeTab === 'session'
              ? 'bg-purple-700 text-white'
              : 'text-gray-400 hover:text-white hover:bg-gray-800'
          }`}
        >
          Session
        </button>
        <button
          onClick={() => setActiveTab('venue')}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
            activeTab === 'venue'
              ? 'bg-purple-700 text-white'
              : 'text-gray-400 hover:text-white hover:bg-gray-800'
          }`}
        >
          Venue
        </button>
        <button
          onClick={() => setActiveTab('account')}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
            activeTab === 'account'
              ? 'bg-purple-700 text-white'
              : 'text-gray-400 hover:text-white hover:bg-gray-800'
          }`}
        >
          Account
        </button>
      </div>

      {/* Account Tab */}
      {activeTab === 'account' && (
        <>
          {/* Streaming Connection Section */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-gray-400">Streaming Connection</h3>
            {isConnected && streamingService ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-sm font-medium ${
                        streamingService === 'spotify' ? 'text-green-400' : 'text-red-400'
                      }`}
                    >
                      {streamingService === 'spotify' ? 'Spotify' : 'YouTube'}
                    </span>
                    <span className="text-xs bg-green-900 text-green-300 px-2 py-0.5 rounded-full">
                      Connected
                    </span>
                  </div>
                  <button
                    onClick={handleDisconnect}
                    className="text-xs text-gray-500 hover:text-red-400 transition-colors"
                  >
                    Disconnect
                  </button>
                </div>
                {(connectedAccountName || connectedAccountEmail) && (
                  <div className="text-xs text-gray-400">
                    {connectedAccountName && <div>Account: {connectedAccountName}</div>}
                    {connectedAccountEmail && <div className="truncate">{connectedAccountEmail}</div>}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-gray-400 text-xs">Connect a streaming service to enable music playback.</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleConnect('spotify')}
                    className="flex-1 bg-green-700 hover:bg-green-600 text-white text-xs font-semibold py-2 rounded-lg text-center transition-colors cursor-pointer"
                  >
                    Spotify
                  </button>
                  <button
                    type="button"
                    onClick={() => handleConnect('youtube')}
                    className="flex-1 bg-red-700 hover:bg-red-600 text-white text-xs font-semibold py-2 rounded-lg text-center transition-colors cursor-pointer"
                  >
                    Google
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Simulated Users Section */}
          {activeSession && (
            <div className="space-y-3 border-t border-gray-800 pt-4">
              <h3 className="text-sm font-medium text-gray-400">Simulated Users</h3>
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-400">Real: {userCount} | Simulated: {simulatedUsers}</span>
              </div>

              {/* Simulate Users Controls */}
              <div className="flex gap-2">
                <button
                  onClick={() => onSimulatedUsersChange(Math.max(0, simulatedUsers - 1))}
                  disabled={simulatedUsers === 0}
                  className="flex-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-white px-2 py-1.5 rounded-lg text-xs font-medium transition-colors"
                >
                  - 1
                </button>
                <button
                  onClick={() => onSimulatedUsersChange(simulatedUsers + 5)}
                  className="flex-1 bg-gray-800 hover:bg-gray-700 text-white px-2 py-1.5 rounded-lg text-xs font-medium transition-colors"
                >
                  + 5
                </button>
                <button
                  onClick={() => onSimulatedUsersChange(0)}
                  disabled={simulatedUsers === 0}
                  className="flex-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-white px-2 py-1.5 rounded-lg text-xs font-medium transition-colors"
                >
                  Reset
                </button>
              </div>

              {/* Show Smart Monetization Preview */}
              {smartMonetizationEnabled && smartSettings && (
                <div className="bg-gray-800 rounded-lg p-2 space-y-1">
                  <p className="text-xs text-gray-400 font-semibold">
                    Smart Settings ({userCount + simulatedUsers} users):
                  </p>
                  <div className="text-xs space-y-0.5">
                    <p className="text-gray-300">
                      💰 Boost: {smartSettings.boostPrice === 0 ? 'FREE' : `$${smartSettings.boostPrice.toFixed(2)}`}
                    </p>
                    <p className="text-gray-300">🎵 Max songs/user: {smartSettings.maxSongsPerUser}</p>
                    <p className="text-gray-300">🔁 Max repeats/hour: {smartSettings.maxSongRepeatsPerHour}</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Venue Tab */}
      {activeTab === 'venue' && (
        <>
          {/* Monetization Settings Section */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-gray-400">Monetization</h3>

            {/* Smart Monetization Toggle */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium">Smart Monetization</label>
                <button
                  onClick={() => setSmartMonetizationEnabled(!smartMonetizationEnabled)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    smartMonetizationEnabled ? 'bg-green-600' : 'bg-gray-700'
                  }`}
                >
                  <span
                    className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                      smartMonetizationEnabled ? 'translate-x-5' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
              <p className="text-xs text-gray-400">
                Auto-adjust pricing based on crowd size
              </p>
            </div>

            {/* Manual Controls - Only show when Smart Monetization is OFF */}
            {!smartMonetizationEnabled && (
              <>
                {/* Monetization Toggle */}
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium">Enable Boost Feature</label>
                  <button
                    onClick={() => setMonetizationEnabled(!monetizationEnabled)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                      monetizationEnabled ? 'bg-green-600' : 'bg-gray-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                        monetizationEnabled ? 'translate-x-5' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {/* Boost Price */}
                <div className="space-y-1">
                  <label className="text-xs font-medium">Boost Price ($)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={defaultBoostPrice}
                    onChange={(e) => setDefaultBoostPrice(parseFloat(e.target.value))}
                    className="w-full bg-gray-800 text-white rounded-lg px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
              </>
            )}
          </div>

          {/* Venue Settings Section */}
          <div className="space-y-3 border-t border-gray-800 pt-4">
            <h3 className="text-sm font-medium text-gray-400">Venue Settings</h3>

            {/* Suggestion Mode Toggle */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium">Suggestion Mode</label>
                <button
                  onClick={() => setSuggestionModeEnabled(!suggestionModeEnabled)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    suggestionModeEnabled ? 'bg-purple-600' : 'bg-gray-700'
                  }`}
                >
                  <span
                    className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                      suggestionModeEnabled ? 'translate-x-5' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
              <p className="text-xs text-gray-400">
                Crowd requests go to a pending list — you approve before they enter the queue
              </p>
            </div>

            {/* Crowd Control Toggle */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium">Crowd Control Mode</label>
                <button
                  onClick={() => setCrowdControlEnabled(!crowdControlEnabled)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    crowdControlEnabled ? 'bg-blue-600' : 'bg-gray-700'
                  }`}
                >
                  <span
                    className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                      crowdControlEnabled ? 'translate-x-5' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
              <p className="text-xs text-gray-400">
                Queue order driven entirely by crowd votes — your actions are logged as overrides
              </p>
            </div>

            {/* Max Song Repeats Per Hour */}
            <div className="space-y-1">
              <label className="text-xs font-medium">Max Song Repeats Per Hour</label>
              <input
                type="number"
                min="0"
                value={maxSongRepeatsPerHour}
                onChange={(e) => setMaxSongRepeatsPerHour(parseInt(e.target.value))}
                className="w-full bg-gray-800 text-white rounded-lg px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>

            {/* Max Songs Per User */}
            <div className="space-y-1">
              <label className="text-xs font-medium">Max Pending Songs Per User</label>
              <input
                type="number"
                min="0"
                value={maxSongsPerUser}
                onChange={(e) => setMaxSongsPerUser(parseInt(e.target.value))}
                className="w-full bg-gray-800 text-white rounded-lg px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>

            {/* Save Button */}
            <button
              onClick={onSaveSettings}
              disabled={loading}
              className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white font-semibold py-1.5 text-xs rounded-lg transition-colors"
            >
              Save Settings
            </button>
            {settingsSaveStatus && (
              <div className="bg-gray-800 rounded-lg p-2 text-xs">{settingsSaveStatus}</div>
            )}
          </div>

          {/* Sponsor / Anthem Songs Section */}
          <div className="space-y-3 border-t border-gray-800 pt-4">
            <h3 className="text-sm font-medium text-gray-400">Anthem &amp; Sponsor Songs</h3>
            <p className="text-xs text-gray-500">
              When these songs come up in the queue or start playing, all users see a special announcement.
            </p>

            {sponsorSongStatus && (
              <div className="bg-gray-800 rounded-lg p-2 text-xs text-amber-300">{sponsorSongStatus}</div>
            )}

            {/* Add sponsor song form */}
            <div className="space-y-2">
              <input
                type="text"
                placeholder="Song ID (from DB)"
                value={sponsorSongForm.songId}
                onChange={(e) => setSponsorSongForm(prev => ({ ...prev, songId: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-amber-500"
              />
              <input
                type="text"
                placeholder="Promotion text (e.g. $2 off tequila shots)"
                value={sponsorSongForm.promotionText}
                onChange={(e) => setSponsorSongForm(prev => ({ ...prev, promotionText: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-amber-500"
              />
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sponsorSongForm.isAnthem}
                    onChange={(e) => setSponsorSongForm(prev => ({ ...prev, isAnthem: e.target.checked }))}
                    className="rounded border-gray-600"
                  />
                  🎺 Mark as Venue Anthem
                </label>
                <button
                  onClick={handleAddSponsorSong}
                  disabled={!sponsorSongForm.songId.trim()}
                  className="text-xs bg-amber-700 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded transition-colors"
                >
                  Add
                </button>
              </div>
            </div>

            {/* Sponsor songs list */}
            {sponsorSongsLoading ? (
              <p className="text-xs text-gray-500">Loading...</p>
            ) : sponsorSongs.length === 0 ? (
              <p className="text-xs text-gray-500">No sponsor or anthem songs configured.</p>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {sponsorSongs.map((ss) => (
                  <div key={ss.id} className="flex items-start gap-2 bg-gray-800 rounded-lg p-2 text-xs">
                    <span className="text-base shrink-0 mt-0.5">{ss.isAnthem ? '🎺' : '⭐'}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{ss.song.title}</p>
                      <p className="text-gray-400 truncate">{ss.song.artist}</p>
                      {ss.promotionText && (
                        <p className="text-amber-400 truncate">🎁 {ss.promotionText}</p>
                      )}
                      <p className="text-gray-600 truncate">ID: {ss.songId}</p>
                    </div>
                    <button
                      onClick={() => handleRemoveSponsorSong(ss.songId)}
                      className="bg-gray-700 hover:bg-red-900 text-white px-2 py-1 rounded transition-colors shrink-0"
                      title="Remove"
                    >
                      🗑
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Session Tab */}
      {activeTab === 'session' && (
        <>
          {/* Session Controls Section */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-gray-400">Session Controls</h3>
            <div className="flex gap-2">
              <button
                onClick={onSessionStart}
                disabled={loading || activeSession}
                className="flex-1 bg-green-700 hover:bg-green-600 disabled:opacity-40 text-white text-sm py-2 rounded-lg font-semibold transition-colors"
              >
                Start
              </button>
              <button
                onClick={onSessionEnd}
                disabled={loading || !activeSession}
                className="flex-1 bg-red-800 hover:bg-red-700 disabled:opacity-40 text-white text-sm py-2 rounded-lg font-semibold transition-colors"
              >
                End
              </button>
            </div>

            {/* Active User Count - Show when session is active */}
            {activeSession && (
              <div className="flex items-center justify-between pt-2">
                <span className="text-sm text-gray-400">Active Users</span>
                <span className="text-green-400 font-mono text-xl">{userCount + simulatedUsers}</span>
              </div>
            )}

            {/* QR Code - Show when session is active */}
            {activeSession && (
              <div className="space-y-2 pt-2">
                <p className="text-gray-400 text-xs">Guests can scan this QR code to join the session.</p>
                <div className="flex justify-center bg-white rounded-lg p-3">
                  <QRCodeSVG
                    value={`${origin}/venues/${venueId}`}
                    size={160}
                    bgColor="#ffffff"
                    fgColor="#000000"
                    level="M"
                  />
                </div>
                <p className="text-center text-xs text-gray-500 break-all">
                  {origin}/venues/{venueId}
                </p>
                {sessionId && (
                  <Link
                    href={`/dev/console?sessionId=${sessionId}`}
                    target="_blank"
                    className="block text-center text-xs text-purple-400 hover:text-purple-300 transition-colors underline"
                  >
                    🎮 Open Dev Console (3 Test Users)
                  </Link>
                )}
              </div>
            )}
          </div>

          {/* Pending Suggestions Section */}
          {activeSession && suggestionModeEnabled && (
            <div className="space-y-3 border-t border-gray-800 pt-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-gray-400">
                  Pending Suggestions
                  {pendingSuggestions.length > 0 && (
                    <span className="ml-2 bg-purple-700 text-white text-xs px-1.5 py-0.5 rounded-full">
                      {pendingSuggestions.length}
                    </span>
                  )}
                </h3>
                {pendingSuggestions.length > 1 && (
                  <div className="flex gap-1">
                    <button
                      onClick={() => onBulkAction('approve', pendingSuggestions.map(s => s.requestId))}
                      disabled={loading}
                      className="text-xs bg-green-700 hover:bg-green-600 disabled:opacity-40 text-white px-2 py-1 rounded transition-colors"
                    >
                      All ✓
                    </button>
                    <button
                      onClick={() => onBulkAction('reject', pendingSuggestions.map(s => s.requestId))}
                      disabled={loading}
                      className="text-xs bg-red-800 hover:bg-red-700 disabled:opacity-40 text-white px-2 py-1 rounded transition-colors"
                    >
                      All ✗
                    </button>
                  </div>
                )}
              </div>

              {pendingSuggestions.length === 0 ? (
                <p className="text-gray-500 text-xs">No pending suggestions.</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {pendingSuggestions.map(suggestion => (
                    <div key={suggestion.requestId} className="flex items-center gap-2 bg-gray-800 rounded-lg p-2 text-xs">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{suggestion.title}</p>
                        <p className="text-gray-400 truncate">{suggestion.artist}</p>
                        {suggestion.displayName && (
                          <p className="text-gray-500 truncate">by {suggestion.displayName}</p>
                        )}
                      </div>
                      <button
                        onClick={() => onApproveSuggestion(suggestion.requestId)}
                        disabled={loading}
                        className="bg-green-700 hover:bg-green-600 disabled:opacity-40 text-white px-2 py-1 rounded transition-colors shrink-0"
                        title="Approve"
                      >
                        ✓
                      </button>
                      <button
                        onClick={() => onRejectSuggestion(suggestion.requestId)}
                        disabled={loading}
                        className="bg-red-800 hover:bg-red-700 disabled:opacity-40 text-white px-2 py-1 rounded transition-colors shrink-0"
                        title="Reject"
                      >
                        ✗
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Playlists Section */}
          <div className="space-y-3 border-t border-gray-800 pt-4">
            <h3 className="text-sm font-medium text-gray-400">Playlists</h3>
            <PlaylistManager
              venueId={venueId}
              password={password}
              streamingService={streamingService}
              youtubePlaylistId={youtubePlaylistId}
              onYoutubePlaylistChange={onYoutubePlaylistChange}
            />
          </div>

        </>
      )}
    </div>
  );
}
