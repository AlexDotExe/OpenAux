/**
 * YouTube ID Resolver
 * Resolves a song title + artist to a YouTube video ID using yt-dlp.
 * Zero YouTube API quota cost.
 */

import { execFile } from 'child_process';

// Cache resolved IDs to avoid duplicate lookups for the same song
const resolveCache = new Map<string, { videoId: string; timestamp: number }>();
const CACHE_TTL_MS = 24 * 60 * 60_000; // 24 hours

export async function resolveYouTubeId(
  query: string,
): Promise<string | undefined> {
  const cacheKey = query.toLowerCase().trim();
  const cached = resolveCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.videoId;
  }

  const videoId = await new Promise<string | undefined>((resolve, reject) => {
    execFile(
      'yt-dlp',
      [`ytsearch1:${query} audio`, '--get-id', '--no-warnings'],
      { timeout: 10_000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`yt-dlp failed: ${stderr || error.message}`));
          return;
        }
        const id = stdout.trim();
        resolve(id || undefined);
      },
    );
  });

  if (videoId) {
    resolveCache.set(cacheKey, { videoId, timestamp: Date.now() });
  }

  return videoId;
}
