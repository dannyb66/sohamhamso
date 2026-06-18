#!/usr/bin/env bun
/**
 * scripts/youtube-db-ensure.ts
 *
 * Idempotently apply `db/schema.sql` (all CREATE TABLE/INDEX IF NOT EXISTS)
 * to the R2-synced youtube state DB so a fresh `db/youtube-state.db`
 * downloaded by `scripts/youtube-state-db.sh` (or seeded from nothing on a
 * first run) gets the youtube lifecycle tables.
 *
 * M0 migration (chapter format): a live pre-M0 DB has a `videos` table
 * WITHOUT the `format` column, so the guarded ALTERs below run BEFORE
 * schema.sql is applied (schema.sql's idx_videos_format_status would
 * otherwise fail with "no such column: format"). After migration the DB is
 * stamped `PRAGMA user_version = 2` — `src/lib/videos-db.ts::getVideosDb`
 * refuses a post-M0 DB from a pre-M0 checkout based on that stamp.
 *
 * Resolves the SAME path as `src/lib/videos-db.ts dbPath()`:
 *   YOUTUBE_DB_PATH → SOHAMHAMSO_DB_PATH → db/sohamhamso.db.
 */
// biome-ignore lint/correctness/noUndeclaredDependencies: bun built-in
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from '../pipeline/youtube/log';

const STAGE = 'db-ensure';

/** Post-M0 schema stamp (videos.format + video_analytics.audio_lang). */
export const YOUTUBE_STATE_USER_VERSION = 2;

/** Mirror src/lib/videos-db.ts dbPath() precedence (env overrides first). */
function dbPath(): string {
  if (process.env.YOUTUBE_DB_PATH) return process.env.YOUTUBE_DB_PATH;
  if (process.env.SOHAMHAMSO_DB_PATH) return process.env.SOHAMHAMSO_DB_PATH;
  return resolve(process.cwd(), 'db', 'sohamhamso.db');
}

/** Repo-rooted schema path (works regardless of cwd, incl. tests). */
function schemaPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', 'db', 'schema.sql');
}

function hasTable(db: Database, name: string): boolean {
  const row = db
    .query<{ n: number }, [string]>(
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name = ?",
    )
    .get(name);
  return (row?.n ?? 0) > 0;
}

function hasColumn(db: Database, table: string, column: string): boolean {
  // pragma_table_info on a missing table returns zero rows (no error).
  const row = db
    .query<{ n: number }, [string]>(
      `SELECT COUNT(*) AS n FROM pragma_table_info('${table}') WHERE name = ?`,
    )
    .get(column);
  return (row?.n ?? 0) > 0;
}

/**
 * Run the guarded M0 ALTERs, apply db/schema.sql, and stamp user_version.
 * Idempotent: safe on a fresh DB (schema.sql creates everything with the
 * new columns), on a pre-M0 DB (ALTERs backfill `format`/`audio_lang`),
 * and on an already-migrated DB (guards skip, IF NOT EXISTS no-ops).
 */
export function applyYoutubeStateMigrations(db: Database): {
  formatAdded: boolean;
  audioLangAdded: boolean;
} {
  let formatAdded = false;
  let audioLangAdded = false;

  // Guarded ALTERs first — see header. Existing rows backfill to 'short'
  // (every pre-M0 row IS a short).
  if (hasTable(db, 'videos') && !hasColumn(db, 'videos', 'format')) {
    db.exec(
      "ALTER TABLE videos ADD COLUMN format TEXT NOT NULL DEFAULT 'short' CHECK(format IN ('short','chapter'))",
    );
    formatAdded = true;
  }
  if (hasTable(db, 'video_analytics') && !hasColumn(db, 'video_analytics', 'audio_lang')) {
    db.exec('ALTER TABLE video_analytics ADD COLUMN audio_lang TEXT');
    audioLangAdded = true;
  }

  db.exec(readFileSync(schemaPath(), 'utf8'));
  db.exec(`PRAGMA user_version = ${YOUTUBE_STATE_USER_VERSION};`);

  return { formatAdded, audioLangAdded };
}

function main(): void {
  const path = dbPath();
  const db = new Database(path, { create: true });
  db.exec('PRAGMA busy_timeout = 5000;');

  const migrated = applyYoutubeStateMigrations(db);
  const hasVideos = hasTable(db, 'videos');

  log(STAGE, 'schema applied', {
    path,
    videosTable: hasVideos,
    formatAdded: migrated.formatAdded,
    audioLangAdded: migrated.audioLangAdded,
    userVersion: YOUTUBE_STATE_USER_VERSION,
  });
  db.close();
}

if (import.meta.main) main();
