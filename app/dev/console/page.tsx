'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

export default function DevConsolePage() {
  const searchParams = useSearchParams();
  const [venueId, setVenueId] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [showConsole, setShowConsole] = useState(false);

  useEffect(() => {
    // Auto-populate sessionId from URL and auto-start console
    const urlSessionId = searchParams.get('sessionId');
    if (urlSessionId) {
      setSessionId(urlSessionId);
      setShowConsole(true);
    }
  }, [searchParams]);

  // Generate unique device fingerprints for each test user
  const user1Fingerprint = 'dev-user-1-' + Date.now();
  const user2Fingerprint = 'dev-user-2-' + Date.now();
  const user3Fingerprint = 'dev-user-3-' + Date.now();

  const handleStart = () => {
    if (sessionId.trim()) {
      setShowConsole(true);
    }
  };

  if (!showConsole) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center p-4">
        <div className="bg-gray-900 rounded-lg p-6 max-w-md w-full">
          <h1 className="text-2xl font-bold mb-4">Dev Console</h1>
          <p className="text-gray-400 text-sm mb-4">
            Test with 3 simultaneous users in the same session
          </p>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Session ID</label>
              <input
                type="text"
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
                placeholder="Enter session ID"
                className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-purple-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                Get session ID from QR code or admin panel
              </p>
            </div>
            <button
              onClick={handleStart}
              disabled={!sessionId.trim()}
              className="w-full bg-purple-700 hover:bg-purple-600 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg transition-colors"
            >
              Start Console
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Dev Console - 3 Test Users</h1>
          <p className="text-sm text-gray-400">Session: {sessionId}</p>
        </div>
        <button
          onClick={() => setShowConsole(false)}
          className="bg-gray-800 hover:bg-gray-700 text-white px-3 py-1 rounded transition-colors text-sm"
        >
          Exit Console
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4 h-[calc(100vh-120px)]">
        {/* User 1 */}
        <div className="bg-gray-900 rounded-lg overflow-hidden flex flex-col">
          <div className="bg-purple-900/40 px-3 py-2 border-b border-purple-700">
            <h2 className="text-sm font-semibold">User 1</h2>
            <p className="text-xs text-gray-400 truncate">{user1Fingerprint}</p>
          </div>
          <iframe
            src={`/session/${sessionId}?devFingerprint=${user1Fingerprint}&devUser=1`}
            className="flex-1 w-full border-0"
            title="User 1 Session"
          />
        </div>

        {/* User 2 */}
        <div className="bg-gray-900 rounded-lg overflow-hidden flex flex-col">
          <div className="bg-blue-900/40 px-3 py-2 border-b border-blue-700">
            <h2 className="text-sm font-semibold">User 2</h2>
            <p className="text-xs text-gray-400 truncate">{user2Fingerprint}</p>
          </div>
          <iframe
            src={`/session/${sessionId}?devFingerprint=${user2Fingerprint}&devUser=2`}
            className="flex-1 w-full border-0"
            title="User 2 Session"
          />
        </div>

        {/* User 3 */}
        <div className="bg-gray-900 rounded-lg overflow-hidden flex flex-col">
          <div className="bg-green-900/40 px-3 py-2 border-b border-green-700">
            <h2 className="text-sm font-semibold">User 3</h2>
            <p className="text-xs text-gray-400 truncate">{user3Fingerprint}</p>
          </div>
          <iframe
            src={`/session/${sessionId}?devFingerprint=${user3Fingerprint}&devUser=3`}
            className="flex-1 w-full border-0"
            title="User 3 Session"
          />
        </div>
      </div>

      <div className="mt-4 bg-gray-900 rounded-lg p-3">
        <p className="text-xs text-gray-400">
          💡 Each user has a unique fingerprint and can perform all actions independently (vote, request songs, boost, etc.)
        </p>
      </div>
    </div>
  );
}
