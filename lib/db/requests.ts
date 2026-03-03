import { prisma } from './prisma';
import { SongRequest, RequestStatus } from '@prisma/client';

/**
 * DB Access Layer - Song Requests
 */

export type SongRequestWithDetails = SongRequest & {
  song: { id: string; title: string; artist: string; bpm: number | null; genreTags: string[] };
  user: { id: string; influenceWeight: number };
  votes: { userId: string; value: number; weight: number }[];
  _count?: { votes: number };
};

export async function createRequest(data: {
  sessionId: string;
  songId: string;
  userId: string;
}): Promise<SongRequest> {
  return prisma.songRequest.create({ data });
}

export async function findActiveRequests(sessionId: string): Promise<SongRequestWithDetails[]> {
  return prisma.songRequest.findMany({
    where: { sessionId, status: { in: ['PENDING', 'APPROVED'] } },
    include: {
      song: { select: { id: true, title: true, artist: true, bpm: true, genreTags: true } },
      user: { select: { id: true, influenceWeight: true } },
      votes: { select: { userId: true, value: true, weight: true } },
    },
    orderBy: { voteWeight: 'desc' },
  }) as Promise<SongRequestWithDetails[]>;
}

export async function updateRequestStatus(
  requestId: string,
  status: RequestStatus,
): Promise<SongRequest> {
  return prisma.songRequest.update({ where: { id: requestId }, data: { status } });
}

export async function updateRequestVoteWeight(
  requestId: string,
  voteWeight: number,
): Promise<SongRequest> {
  return prisma.songRequest.update({ where: { id: requestId }, data: { voteWeight } });
}

export async function findRequestById(id: string): Promise<SongRequestWithDetails | null> {
  return prisma.songRequest.findUnique({
    where: { id },
    include: {
      song: { select: { id: true, title: true, artist: true, bpm: true, genreTags: true } },
      user: { select: { id: true, influenceWeight: true } },
      votes: { select: { userId: true, value: true, weight: true } },
    },
  }) as Promise<SongRequestWithDetails | null>;
}

export async function checkDuplicateRequest(
  sessionId: string,
  songId: string,
): Promise<SongRequest | null> {
  return prisma.songRequest.findFirst({
    where: {
      sessionId,
      songId,
      status: { in: ['PENDING', 'APPROVED'] },
    },
  });
}
