/**
 * Shared Postgres pool — the only place a pg Pool is created.
 * Every workstream imports { pool } from '../db.js' (or a repository built on it).
 * Keep SQL inside your owned folder; this module stays connection-only.
 */
import pg from 'pg';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://localhost:5432/openaux',
});

export async function closePool(): Promise<void> {
  await pool.end();
}
