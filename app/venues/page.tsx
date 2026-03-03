'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Venue {
  id: string;
  name: string;
  genreProfile: { primary?: string; secondary?: string[] };
  createdAt: string;
}

export default function VenuesPage() {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/venues')
      .then((r) => r.json())
      .then(setVenues)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        <p className="text-gray-400 animate-pulse">Loading venues...</p>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-md mx-auto space-y-4">
        <h1 className="text-2xl font-bold">🏢 Venues</h1>
        {venues.length === 0 ? (
          <p className="text-gray-400">No venues yet. Check back soon!</p>
        ) : (
          venues.map((v) => (
            <Link
              key={v.id}
              href={`/venues/${v.id}`}
              className="block bg-gray-900 rounded-xl p-4 hover:bg-gray-800 transition-colors"
            >
              <div className="font-semibold text-lg">{v.name}</div>
              {v.genreProfile?.primary && (
                <div className="text-purple-400 text-sm mt-1">{v.genreProfile.primary}</div>
              )}
            </Link>
          ))
        )}
      </div>
    </main>
  );
}
