'use client';

import { useState, useEffect, useCallback } from 'react';

interface SpotifyDevice {
  id: string;
  name: string;
  type: string;
  is_active: boolean;
}

interface Props {
  venueId: string;
  streamingService: string | null;
}

export function SpotifyDeviceSelector({ venueId, streamingService }: Props) {
  const [devices, setDevices] = useState<SpotifyDevice[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchDevices = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/${venueId}/devices`);
      if (res.ok) {
        const data = await res.json();
        setDevices(data.devices ?? []);
      }
    } catch {
      // Ignore
    } finally {
      setLoading(false);
    }
  }, [venueId]);

  useEffect(() => {
    if (streamingService === 'spotify') {
      fetchDevices();
    }
  }, [streamingService, fetchDevices]);

  if (streamingService !== 'spotify') return null;

  const handleTransfer = async (deviceId: string) => {
    await fetch(`/api/admin/${venueId}/playback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'play', trackId: '_transfer', deviceId }),
    });
    fetchDevices();
  };

  return (
    <div className="bg-gray-900 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Spotify Devices</h2>
        <button
          onClick={fetchDevices}
          disabled={loading}
          className="text-xs text-green-400 hover:text-green-300 transition-colors"
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {devices.length === 0 ? (
        <p className="text-gray-500 text-sm">No devices found. Open Spotify on a device.</p>
      ) : (
        <div className="space-y-2">
          {devices.map((device) => (
            <button
              key={device.id}
              onClick={() => handleTransfer(device.id)}
              className={`w-full flex items-center justify-between p-2 rounded-lg text-sm transition-colors ${
                device.is_active
                  ? 'bg-green-900/30 border border-green-700 text-green-300'
                  : 'bg-gray-800 hover:bg-gray-700 text-white'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">{device.type}</span>
                <span>{device.name}</span>
              </div>
              {device.is_active && (
                <span className="text-xs text-green-400">Active</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
