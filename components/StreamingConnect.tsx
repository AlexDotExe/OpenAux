'use client';

interface Props {
  venueId: string;
  streamingService: string | null;
  isConnected: boolean;
  connectedAccountName?: string | null;
  connectedAccountEmail?: string | null;
  onDisconnect: () => void;
}

export function StreamingConnect({ venueId, streamingService, isConnected, connectedAccountName, connectedAccountEmail, onDisconnect }: Props) {
  const handleDisconnect = async () => {
    await fetch(`/api/admin/${venueId}/disconnect`, { method: 'POST' });
    onDisconnect();
  };

  if (isConnected && streamingService) {
    const label = streamingService === 'spotify' ? 'Spotify' : 'YouTube';
    const color = streamingService === 'spotify' ? 'text-green-400' : 'text-red-400';

    return (
      <div className="bg-gray-900 rounded-xl p-4 space-y-3">
        <h2 className="font-semibold">Streaming</h2>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`text-sm font-medium ${color}`}>{label}</span>
              <span className="text-xs bg-green-900 text-green-300 px-2 py-0.5 rounded-full">Connected</span>
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
      </div>
    );
  }

  return (
    <div className="bg-gray-900 rounded-xl p-4 space-y-3">
      <h2 className="font-semibold">Connect Streaming</h2>
      <p className="text-gray-400 text-sm">Connect a streaming service to enable music playback and search.</p>
      <div className="flex gap-3">
        <a
          href={`/api/admin/${venueId}/connect/spotify`}
          className="flex-1 bg-green-700 hover:bg-green-600 text-white text-sm font-semibold py-2 rounded-lg text-center transition-colors"
        >
          Connect Spotify
        </a>
        <a
          href={`/api/admin/${venueId}/connect/youtube`}
          className="flex-1 bg-red-700 hover:bg-red-600 text-white text-sm font-semibold py-2 rounded-lg text-center transition-colors"
        >
          Connect YouTube
        </a>
      </div>
    </div>
  );
}
