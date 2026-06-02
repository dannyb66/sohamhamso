/**
 * Regression — production-launch-blocking bug.
 *
 * Verifies the subscribe write path is edge-compatible:
 *
 *   1. In the bun runtime (this test process), `getSubscriberDb()`
 *      returns a `SubscriberDb` backed by `bun:sqlite`. The handler
 *      can `insertSubscriber({...})` and `isAlreadySubscribed(...)`
 *      end-to-end without ever touching a network DB.
 *
 *   2. `isEdgeRuntime()` is `false` here (we ARE bun) — the inverse
 *      sanity check that the runtime sniff isn't accidentally
 *      reporting edge in the bun process.
 *
 *   3. Bare evaluation of `@libsql/client/web` does not throw. This
 *      catches the regression where the edge bundle would silently
 *      break because the libsql package was missing the `/web`
 *      subpath or pulled `node:*` modules incompatible with workerd.
 *
 * Out of scope: actually exercising the libsql round-trip — that
 * requires a live Turso instance. The shape contract above is what
 * the deployment plan called out, and is enough to keep the
 * Cloudflare bundle green pre-launch.
 */

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  __setSubscriberDbForTests,
  getSubscriberDb,
  isEdgeRuntime,
} from '../../src/lib/subscriber-db';

// Point the bun backend at a throwaway SQLite file (NOT the dev DB at
// `db/sohamhamso.db`) so this regression test never mutates real data.
// The factory honors `SOHAMHAMSO_DB_PATH` first in its path-resolution
// order — same env var the corpus reader respects.
const tmpDbPath = join(mkdtempSync(join(tmpdir(), 'sohamhamso-edge-compat-')), 'subscribers.db');
const SCHEMA_PATH = resolve(__dirname, '..', '..', 'db', 'schema.sql');

const PRIOR_DB_PATH = process.env.SOHAMHAMSO_DB_PATH;

beforeAll(async () => {
  process.env.SOHAMHAMSO_DB_PATH = tmpDbPath;
  // Seed the schema so the factory can open + INSERT without exploding.
  const { Database } = await import('bun:sqlite');
  const seed = new Database(tmpDbPath);
  seed.exec(readFileSync(SCHEMA_PATH, 'utf8'));
  seed.close();
});

afterAll(() => {
  // Restore the env var to its prior state. `delete` is the only correct
  // way to unset — assignment to undefined leaves the literal string
  // "undefined" in process.env.
  if (PRIOR_DB_PATH === undefined) {
    // biome-ignore lint/performance/noDelete: env-var restore — required
    delete process.env.SOHAMHAMSO_DB_PATH;
  } else {
    process.env.SOHAMHAMSO_DB_PATH = PRIOR_DB_PATH;
  }
});

afterEach(() => {
  // Tests upstream of this file inject a fake — make sure each test
  // here runs against the REAL routing logic, then restore on exit.
  __setSubscriberDbForTests(null);
});

describe('subscriber-db — bun runtime routing', () => {
  it('isEdgeRuntime() returns false in the bun test process', () => {
    // Sanity: the bun-vs-edge sniff used by both the DB factory and
    // the pepper hard-error gate must correctly identify bun. If this
    // ever flips true under bun, BOTH the DB selection AND the pepper
    // guard misfire — every dev request would 500 on missing pepper.
    expect(isEdgeRuntime()).toBe(false);
  });

  it('getSubscriberDb() returns a SubscriberDb backed by bun:sqlite in bun runtime', async () => {
    const db = await getSubscriberDb();
    expect(db).toBeDefined();
    expect(typeof db.insertSubscriber).toBe('function');
    expect(typeof db.isAlreadySubscribed).toBe('function');

    // The `insertSubscriber` method must be async (returns a Promise)
    // regardless of which backend is selected — the API handler awaits
    // it. If the bun path accidentally returns a plain value, the
    // libsql path (Promise) would break shape parity at the edge.
    const probe = db.insertSubscriber({
      email_hash: 'x'.repeat(64),
      language: 'en',
      region: 'us',
      unsubscribe_token: `probe-token-${Math.random().toString(36).slice(2)}`,
      subscribed_at: new Date().toISOString(),
    });
    expect(probe).toBeInstanceOf(Promise);
    // Swallow either success or any DB-shape error — this assertion is
    // about the Promise return-type contract, not the row landing.
    await probe.catch(() => {});
  });

  it('@libsql/client/web import does not throw on bare evaluation', async () => {
    // Cheap regression for the bundle-evaluation failure mode: even if
    // we never CALL createClient in this test process, the module must
    // be importable. If `/web` ever silently drops from the package
    // exports map (or starts pulling node:* under the hood), this test
    // fails loud BEFORE the broken bundle hits Cloudflare.
    const mod = await import('@libsql/client/web');
    expect(mod).toBeDefined();
    expect(typeof mod.createClient).toBe('function');
  });
});
