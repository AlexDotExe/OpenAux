import { PrismaClient } from '@prisma/client';

// Singleton pattern to avoid multiple Prisma Client instances in development
// See: https://www.prisma.io/docs/guides/performance-and-optimization/connection-management

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma =
  globalThis.__prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__prisma = prisma;
}
