/**
 * API Route: Import Spotify Playlists
 * POST /api/admin/[venueId]/playlists/import-spotify
 *   - Fetches the admin's Spotify playlists and imports them as VenuePlaylist records
 */

import { NextRequest, NextResponse } from 'next/server';
import { findVenueById, verifyAdminToken } from '@/lib/db/venues';
import { listPlaylists, createPlaylist, addSongToPlaylist } from '@/lib/db/playlists';
import { findOrCreateSong } from '@/lib/db/songs';
import { withValidToken } from '@/lib/services/streaming/tokenManager';
import { refreshSpotifyToken } from '@/lib/services/streaming/spotify';

const SPOTIFY_API = 'https://api.spotify.com/v1';

interface SpotifyPlaylistItem {
  id: string;
  name: string;
  tracks: { total: number; href: string };
}

interface SpotifyTrackItem {
  track: {
    id: string;
    name: string;
    artists: Array<{ name: string }>;
    album: { images: Array<{ url: string }> };
    duration_ms: number;
  } | null;
}

interface RouteContext {
  params: Promise<{ venueId: string }>;
}

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { venueId } = await context.params;
    const body = await req.json().catch(() => ({}));
    const { adminPassword } = body;

    if (!await verifyAdminToken(venueId, adminPassword ?? '')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const venue = await findVenueById(venueId);
    if (!venue) {
      return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    }

    if (venue.streamingService !== 'spotify' || !venue.oauthAccessToken) {
      return NextResponse.json(
        { error: 'Spotify not connected to this venue' },
        { status: 400 },
      );
    }

    // Get existing playlist names so we can skip duplicates
    const existingPlaylists = await listPlaylists(venueId);
    const existingNames = new Set(existingPlaylists.map((p) => p.name));

    // Fetch Spotify playlists using token management
    const importedPlaylists = await withValidToken(
      venueId,
      refreshSpotifyToken,
      async (accessToken) => {
        // Fetch user's playlists (first 50)
        const playlistsRes = await fetch(`${SPOTIFY_API}/me/playlists?limit=50`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (!playlistsRes.ok) {
          const text = await playlistsRes.text();
          throw new Error(`Failed to fetch Spotify playlists: ${playlistsRes.status} ${text}`);
        }

        const playlistsData = await playlistsRes.json();
        const spotifyPlaylists: SpotifyPlaylistItem[] = playlistsData.items ?? [];

        const imported: Array<{ name: string; songCount: number }> = [];

        for (const sp of spotifyPlaylists) {
          // Skip playlists that already exist with the same name
          if (existingNames.has(sp.name)) {
            continue;
          }

          // Create the venue playlist
          const playlist = await createPlaylist(venueId, sp.name);
          existingNames.add(sp.name);

          // Fetch tracks for this playlist (first 100)
          const tracksRes = await fetch(
            `${SPOTIFY_API}/playlists/${encodeURIComponent(sp.id)}/tracks?limit=100&fields=items(track(id,name,artists(name),album(images),duration_ms))`,
            { headers: { Authorization: `Bearer ${accessToken}` } },
          );

          if (!tracksRes.ok) {
            console.error(
              `[import-spotify] Failed to fetch tracks for playlist "${sp.name}":`,
              await tracksRes.text(),
            );
            imported.push({ name: sp.name, songCount: 0 });
            continue;
          }

          const tracksData = await tracksRes.json();
          const tracks: SpotifyTrackItem[] = tracksData.items ?? [];
          let songCount = 0;

          for (const item of tracks) {
            if (!item.track || !item.track.id) continue;

            const t = item.track;
            const song = await findOrCreateSong({
              spotifyId: t.id,
              title: t.name,
              artist: t.artists.map((a) => a.name).join(', '),
              albumArtUrl: t.album?.images?.[0]?.url,
              durationMs: t.duration_ms,
            });

            await addSongToPlaylist(playlist.id, song.id);
            songCount++;
          }

          imported.push({ name: sp.name, songCount });
        }

        return imported;
      },
    );

    return NextResponse.json({
      imported: importedPlaylists,
      message: `Imported ${importedPlaylists.length} playlist(s) from Spotify`,
    });
  } catch (err) {
    console.error('[POST /api/admin/:venueId/playlists/import-spotify]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
