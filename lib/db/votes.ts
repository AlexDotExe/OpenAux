import { prisma } from './prisma';
import { Vote } from '@prisma/client';

/**
 * DB Access Layer - Votes
 */

export async function castVote(data: {
  requestId: string;
  userId: string;
  value: number; // +1 or -1
  weight: number;
}): Promise<Vote> {
  return prisma.vote.upsert({
    where: { requestId_userId: { requestId: data.requestId, userId: data.userId } },
    update: { value: data.value, weight: data.weight },
    create: data,
  });
}

export async function findVoteByUser(requestId: string, userId: string): Promise<Vote | null> {
  return prisma.vote.findUnique({
    where: { requestId_userId: { requestId, userId } },
  });
}

export async function recalculateRequestVoteWeight(requestId: string): Promise<number> {
  const votes = await prisma.vote.findMany({
    where: { requestId },
    select: { value: true, weight: true },
  });
  const total = votes.reduce((sum, v) => sum + v.value * v.weight, 0);
  await prisma.songRequest.update({ where: { id: requestId }, data: { voteWeight: total } });
  return total;
}
