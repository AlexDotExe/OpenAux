'use client';

import { useState, useEffect, useCallback } from 'react';

interface SpotifyDevice {
  id: string;
  name: string;
  type: string;
  is_active: boolean;
}

interface SpotifyDevicePickerProps {
  venueId: string;
  adminToken: string;
  selectedDeviceId: string | null;
  onDeviceSelected: (deviceId: string) => void;
}

export function SpotifyDevicePicker({
  venueId,
  adminToken,
  selectedDeviceId,
  onDeviceSelected,
}: SpotifyDevicePickerProps) {
  const [devices, setDevices] = useState<SpotifyDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDevices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/${venueId}/devices`, {
        headers: { 'x-admin-password': adminToken },
      });
      if (res.ok) {
        const data = await res.json();
        setDevices(data.devices ?? []);
      } else {
        setError('Failed to load devices');
      }
    } catch {
      setError('Failed to load devices');
    } finally {
      setLoading(false);
    }
  }, [venueId, adminToken]);

  useEffect(() => {
    fetchDevices();
  }, [fetchDevices]);

  const handleSelect = async (deviceId: string) => {
    setSelecting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/${venueId}/devices/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminPassword: adminToken, deviceId }),
      });
      if (res.ok) {
        onDeviceSelected(deviceId);
        // Refresh device list to show updated active status
        await fetchDevices();
      } else {
        setError('Failed to select device');
      }
    } catch {
      setError('Failed to select device');
    } finally {
      setSelecting(false);
    }
  };

  const deviceIcon = (type: string) => {
    switch (type.toLowerCase()) {
      case 'computer': return '💻';
      case 'smartphone': return '📱';
      case 'speaker': return '🔊';
      default: return '🎵';
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium text-gray-400">Spotify Device</h4>
        <button
          onClick={fetchDevices}
          disabled={loading}
          className="text-xs text-gray-500 hover:text-white transition-colors disabled:opacity-40"
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}

      {!loading && devices.length === 0 && (
        <div className="bg-gray-800 rounded-lg p-3 text-xs text-gray-500 text-center">
          No Spotify devices found. Open Spotify on a device to make it available.
        </div>
      )}

      {devices.length > 0 && (
        <div className="space-y-1">
          {devices.map((device) => {
            const isSelected = device.id === selectedDeviceId;
            return (
              <button
                key={device.id}
                onClick={() => handleSelect(device.id)}
                disabled={selecting || isSelected}
                className={`w-full flex items-center gap-2 text-left text-xs px-3 py-2 rounded-lg transition-colors ${
                  isSelected
                    ? 'bg-green-900/50 border border-green-700 text-green-300'
                    : 'bg-gray-800 hover:bg-gray-700 text-white'
                } disabled:opacity-60`}
              >
                <span>{deviceIcon(device.type)}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{device.name}</p>
                  <p className="text-gray-500 capitalize">{device.type.toLowerCase()}</p>
                </div>
                {isSelected && (
                  <span className="text-green-400 text-[10px] uppercase font-medium shrink-0">Active</span>
                )}
                {!isSelected && device.is_active && (
                  <span className="text-yellow-500 text-[10px] uppercase font-medium shrink-0">Playing</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
