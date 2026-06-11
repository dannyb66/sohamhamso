#!/usr/bin/env bun
/**
 * scripts/youtube-db-ensure.ts
 *
 * Idempotently apply `db/schema.sql` (all CREATE TABLE/INDEX IF NOT EXISTS)
 * to the R2-synced youtube state DB so a fresh `db/youtube-state.db`
 * downloaded by `scripts/youtube-state-db.sh` (or seeded from nothing on a
 * first run) gets the youtube lifecycle tables.
 *
 * Resolves the SAME path as `src/lib/videos-db.ts dbPath()`:
 *   YOUTUBE_DB_PATH → SOHAMHAMSO_DB_PATH → db/sohamhamso.db.
 */
// biome-ignore lint/correctness/noUndeclaredDependencies: bun built-in
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { log } from '../pipeline/youtube/log';

const STAGE = 'db-ensure';

/** Mirror src/lib/videos-db.ts dbPath() precedence (env overrides first). */
function dbPath(): string {
  if (process.env.YOUTUBE_DB_PATH) return process.env.YOUTUBE_DB_PATH;
  if (process.env.SOHAMHAMSO_DB_PATH) return process.env.SOHAMHAMSO_DB_PATH;
  return resolve(process.cwd(), 'db', 'sohamhamso.db');
}

const path = dbPath();
const schema = readFileSync('db/schema.sql', 'utf8');
const db = new Database(path, { create: true });
db.exec('PRAGMA busy_timeout = 5000;');
db.exec(schema);

const hasVideos = db
  .query<{ n: number }, []>(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='videos'",
  )
  .get();

log(STAGE, 'schema applied', { path, videosTable: (hasVideos?.n ?? 0) > 0 });
db.close();
