import { prisma } from './prisma';
import { Session } from '@prisma/client';

/**
 * DB Access Layer - Sessions
 */

export async function findActiveSession(venueId: string): Promise<Session | null> {
  return prisma.session.findFirst({
    where: { venueId, isActive: true },
    orderBy: { startedAt: 'desc' },
  });
}

export async function findSessionById(id: string): Promise<Session | null> {
  return prisma.session.findUnique({ where: { id } });
}

export async function createSession(venueId: string): Promise<Session> {
  // Ensure any previous session is ended
  await prisma.session.updateMany({
    where: { venueId, isActive: true },
    data: { isActive: false, endedAt: new Date() },
  });
  return prisma.session.create({ data: { venueId } });
}

export async function endSession(sessionId: string): Promise<Session> {
  return prisma.session.update({
    where: { id: sessionId },
    data: { isActive: false, endedAt: new Date() },
  });
}

export async function updateEnergyLevel(sessionId: string, energyLevel: number): Promise<Session> {
  const clamped = Math.max(0, Math.min(1, energyLevel));
  return prisma.session.update({
    where: { id: sessionId },
    data: { currentEnergyLevel: clamped },
  });
}
