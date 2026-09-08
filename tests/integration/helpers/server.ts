/**
 * Boots the REAL server process for integration tests.
 *
 * We spawn `apps/server/src/index.ts` rather than re-composing the app in-test,
 * so the suite exercises the actual composition root (route registration, plugin
 * wiring, the shared pg pool) exactly as deployed. That is the whole point of
 * this layer: the unit suite already covers pure logic with stubs, and it is
 * blind to SQL and wiring bugs by construction.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** Test-only console/venue-admin shared secret (EnvConsoleTokenProvider reads VENUE_ADMIN_TOKEN). */
export const CONSOLE_TOKEN = 'integration-console-token';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://openaux:openaux@localhost:5433/openaux_test';

export interface RunningServer {
  baseUrl: string;
  stop(): Promise<void>;
}

/**
 * Start the server on an unused port against the test database, with the
 * deterministic fake music provider so no Spotify credentials are needed.
 */
export async function startServer(port = 4010): Promise<RunningServer> {
  const child: ChildProcess = spawn(
    path.join(REPO_ROOT, 'node_modules/.bin/tsx'),
    ['apps/server/src/index.ts'],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        PORT: String(port),
        DATABASE_URL: TEST_DATABASE_URL,
        MUSIC_PROVIDER_FAKE: '1',
        VENUE_ADMIN_TOKEN: CONSOLE_TOKEN,
        // Keep the payment gateway fake — never touch a real Stripe account.
        STRIPE_SECRET_KEY: '',
        NODE_ENV: 'test',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  const logs: string[] = [];
  child.stdout?.on('data', (d) => logs.push(String(d)));
  child.stderr?.on('data', (d) => logs.push(String(d)));

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`server exited early (code ${child.exitCode}):\n${logs.join('')}`);
    }
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) {
        return {
          baseUrl,
          async stop() {
            child.kill('SIGTERM');
            await delay(300);
            if (child.exitCode === null) child.kill('SIGKILL');
          },
        };
      }
    } catch {
      // not listening yet
    }
    await delay(250);
  }

  child.kill('SIGKILL');
  throw new Error(
    `server did not become healthy on ${baseUrl}/health within 60s.\n` +
      `Is the test database up? (docker compose -f docker-compose.test.yml up -d)\n${logs.join('')}`,
  );
}
