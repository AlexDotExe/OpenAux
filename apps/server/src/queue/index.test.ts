/**
 * Covers the service-exposure change to `registerQueueRoutes`: it must return the
 * `QueueService` it registered routes with (or reuse a pre-built one), so the
 * composition root can stop constructing a second, duplicate service just to reach
 * `advance`/`playNow`/`playNext` programmatically. See index.ts doc comment for the
 * exact migration note.
 *
 * Constructing `PostgresQueueRepository(pool)` here performs no I/O — the pg pool
 * connects lazily on first query (see ../db.ts) — so this stays a pure unit test.
 */
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { pool } from '../db.js';
import { registerQueueRoutes } from './index.js';
import { PostgresQueueRepository } from './repository.js';
import { createQueueService, QueueService } from './service.js';

describe('registerQueueRoutes — service exposure', () => {
  it('returns the QueueService instance it registered routes with', () => {
    const app = Fastify();
    const repository = new PostgresQueueRepository(pool);

    const service = registerQueueRoutes(app, { repository });

    expect(service).toBeInstanceOf(QueueService);
  });

  it('reuses a pre-built service instead of constructing a duplicate', () => {
    const app = Fastify();
    const repository = new PostgresQueueRepository(pool);
    const prebuilt = createQueueService({ repository });

    const returned = registerQueueRoutes(app, { repository, service: prebuilt });

    expect(returned).toBe(prebuilt);
  });

  it('stays backward compatible with the existing void-return call shape', () => {
    const app = Fastify();
    const repository = new PostgresQueueRepository(pool);

    // Mirrors the current apps/server/src/index.ts call: `registerQueueRoutes(app, opts);`
    // with the return value ignored. Must still register without requiring `service`.
    const result = registerQueueRoutes(app, { repository });

    expect(result).toBeInstanceOf(QueueService);
  });
});
