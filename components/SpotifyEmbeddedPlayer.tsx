'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface Props {
  venueId: string;
  onTrackEnded?: () => void;
  onDeviceReady?: (deviceId: string) => void;
  accessToken: string;
}

interface SpotifyPlayer {
  connect: () => Promise<boolean>;
  disconnect: () => void;
  addListener: (event: string, callback: (...args: any[]) => void) => void;
  removeListener: (event: string, callback: (...args: any[]) => void) => void;
  getCurrentState: () => Promise<any>;
  togglePlay: () => Promise<void>;
  nextTrack: () => Promise<void>;
  previousTrack: () => Promise<void>;
  seek: (position: number) => Promise<void>;
  setVolume: (volume: number) => Promise<void>;
}

declare global {
  interface Window {
    Spotify: {
      Player: new (config: {
        name: string;
        getOAuthToken: (cb: (token: string) => void) => void;
        volume: number;
      }) => SpotifyPlayer;
    };
    onSpotifyWebPlaybackSDKReady: () => void;
  }
}

export function SpotifyEmbeddedPlayer({ venueId, onTrackEnded, onDeviceReady, accessToken }: Props) {
  const [player, setPlayer] = useState<SpotifyPlayer | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState(true);
  const [currentTrack, setCurrentTrack] = useState<any>(null);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.5);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Load Spotify Web Playback SDK
  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://sdk.scdn.co/spotify-player.js';
    script.async = true;
    document.body.appendChild(script);

    return () => {
      document.body.removeChild(script);
    };
  }, []);

  // Initialize player
  useEffect(() => {
    if (!accessToken) return;

    window.onSpotifyWebPlaybackSDKReady = () => {
      const spotifyPlayer = new window.Spotify.Player({
        name: 'OpenAux Admin Player',
        getOAuthToken: (cb) => {
          cb(accessToken);
        },
        volume: volume,
      });

      // Ready
      spotifyPlayer.addListener('ready', ({ device_id }: { device_id: string }) => {
        console.log('[SpotifyPlayer] Ready with Device ID', device_id);
        setDeviceId(device_id);
        setError(null);
        onDeviceReady?.(device_id);
      });

      // Not Ready
      spotifyPlayer.addListener('not_ready', ({ device_id }: { device_id: string }) => {
        console.log('[SpotifyPlayer] Device ID has gone offline', device_id);
        setError('Player offline');
      });

      // Player state changed
      spotifyPlayer.addListener('player_state_changed', (state: any) => {
        if (!state) return;

        setCurrentTrack(state.track_window.current_track);
        setIsPaused(state.paused);
        setPosition(state.position);
        setDuration(state.duration);

        // Track ended
        if (
          state.position === 0 &&
          state.paused &&
          state.track_window.previous_tracks.length > 0
        ) {
          console.log('[SpotifyPlayer] Track ended');
          onTrackEnded?.();
        }
      });

      // Errors
      spotifyPlayer.addListener('initialization_error', ({ message }: { message: string }) => {
        console.error('[SpotifyPlayer] Initialization error:', message);
        setError(`Initialization error: ${message}`);
      });

      spotifyPlayer.addListener('authentication_error', ({ message }: { message: string }) => {
        console.error('[SpotifyPlayer] Authentication error:', message);
        setError(`Authentication error: ${message}`);
      });

      spotifyPlayer.addListener('account_error', ({ message }: { message: string }) => {
        console.error('[SpotifyPlayer] Account error:', message);
        setError(`Account error: ${message}`);
      });

      spotifyPlayer.addListener('playback_error', ({ message }: { message: string }) => {
        console.error('[SpotifyPlayer] Playback error:', message);
        setError(`Playback error: ${message}`);
      });

      spotifyPlayer.connect();
      setPlayer(spotifyPlayer);
    };

    return () => {
      player?.disconnect();
    };
  }, [accessToken, volume, onTrackEnded]);

  // Update position every second when playing
  useEffect(() => {
    if (!isPaused && player) {
      intervalRef.current = setInterval(async () => {
        const state = await player.getCurrentState();
        if (state) {
          setPosition(state.position);
        }
      }, 1000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isPaused, player]);

  const togglePlayback = useCallback(async () => {
    if (player) {
      await player.togglePlay();
    }
  }, [player]);

  const skipTrack = useCallback(async () => {
    if (player) {
      await player.nextTrack();
      onTrackEnded?.();
    }
  }, [player, onTrackEnded]);

  const handleVolumeChange = useCallback(async (newVolume: number) => {
    setVolume(newVolume);
    if (player) {
      await player.setVolume(newVolume);
    }
  }, [player]);

  const formatTime = (ms: number) => {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  if (error) {
    return (
      <div className="bg-red-900/20 border border-red-700 rounded-xl p-4">
        <h2 className="font-semibold mb-2">Spotify Player Error</h2>
        <p className="text-sm text-red-400">{error}</p>
        <p className="text-xs text-gray-400 mt-2">
          Make sure you have Spotify Premium and are logged in.
        </p>
      </div>
    );
  }

  if (!deviceId) {
    return (
      <div className="bg-gray-900 rounded-xl p-4">
        <h2 className="font-semibold mb-2">Spotify Player</h2>
        <p className="text-gray-400 text-sm animate-pulse">Initializing player...</p>
      </div>
    );
  }

  if (!currentTrack) {
    return (
      <div className="bg-gray-900 rounded-xl p-4">
        <h2 className="font-semibold mb-2">Spotify Player</h2>
        <p className="text-gray-500 text-sm">Ready to play. Advance the queue to start.</p>
        <p className="text-xs text-gray-600 mt-1">Device: OpenAux Admin Player</p>
      </div>
    );
  }

  const progressPct = duration > 0 ? (position / duration) * 100 : 0;

  return (
    <div className="bg-gray-900 rounded-xl p-4 space-y-3">
      <h2 className="font-semibold">Now Playing</h2>

      {/* Track Info */}
      <div className="flex items-center gap-3">
        {currentTrack.album?.images?.[0]?.url && (
          <img
            src={currentTrack.album.images[0].url}
            alt={currentTrack.name}
            className="w-14 h-14 rounded-lg object-cover"
          />
        )}
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate">{currentTrack.name}</p>
          <p className="text-gray-400 text-xs truncate">
            {currentTrack.artists?.map((a: any) => a.name).join(', ')}
          </p>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="space-y-1">
        <div className="w-full h-1.5 bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-green-500 rounded-full transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-gray-500">
          <span>{formatTime(position)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-4">
        <button
          onClick={togglePlayback}
          className="bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          {isPaused ? '▶️ Play' : '⏸️ Pause'}
        </button>
        <button
          onClick={skipTrack}
          className="bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          ⏭️ Skip
        </button>
        <div className="flex items-center gap-2 flex-1">
          <span className="text-xs text-gray-500">🔊</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
            className="flex-1 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
          />
        </div>
      </div>
    </div>
  );
}
