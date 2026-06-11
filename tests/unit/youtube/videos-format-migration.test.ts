/**
 * videos-format-migration.test.ts
 *
 * M0 schema migration (chapter format): `applyYoutubeStateMigrations` on a
 * pre-M0 DB shape (videos without `format`, video_analytics without
 * `audio_lang`) adds the columns via guarded ALTERs, creates
 * idx_videos_format_status, stamps `PRAGMA user_version = 2`, and is
 * idempotent on a second run. Plus the `getVideosDb` checkout-vs-DB guard:
 * a post-M0 stamp on a DB whose videos table lacks `format` must refuse
 * to open (pre-M0 checkouts must not silently process chapter rows).
 *
 * Self-contained: builds its own old-shape DB inline (no _db-helpers).
 */
// biome-ignore lint/correctness/noUndeclaredDependencies: bun built-in
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  YOUTUBE_STATE_USER_VERSION,
  applyYoutubeStateMigrations,
} from '../../../scripts/youtube-db-ensure';
import { getVideosDb } from '../../../src/lib/videos-db';

/**
 * Minimal pre-M0 `videos` / `video_analytics` shape: just the columns the
 * post-migration schema.sql indexes touch (idx_videos_status,
 * idx_videos_verse_lookup, idx_video_analytics_video) — NO `format`, NO
 * `audio_lang`.
 */
function buildOldShapeDb(path = ':memory:'): Database {
  const db = new Database(path, { create: true });
  db.exec(`
    CREATE TABLE videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text_id TEXT NOT NULL,
      chapter INTEGER NOT NULL,
      verse_num INTEGER NOT NULL,
      lang TEXT NOT NULL,
      short_index INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      retry_count INTEGER DEFAULT 0,
      priority INTEGER DEFAULT 0
    );
    CREATE TABLE video_analytics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id INTEGER NOT NULL,
      synced_at TEXT NOT NULL,
      UNIQUE (video_id, synced_at)
    );
    INSERT INTO videos (text_id, chapter, verse_num, lang, status)
    VALUES ('siva-sutras', 1, 1, 'en', 'uploaded');
  `);
  return db;
}

function hasColumn(db: Database, table: string, column: string): boolean {
  const row = db
    .query<{ n: number }, [string]>(
      `SELECT COUNT(*) AS n FROM pragma_table_info('${table}') WHERE name = ?`,
    )
    .get(column);
  return (row?.n ?? 0) > 0;
}

function userVersion(db: Database): number {
  return db.query<{ user_version: number }, []>('PRAGMA user_version').get()!.user_version;
}

describe('applyYoutubeStateMigrations — pre-M0 DB', () => {
  it('adds the format column, backfilling existing rows to short', () => {
    const db = buildOldShapeDb();
    const res = applyYoutubeStateMigrations(db);
    expect(res.formatAdded).toBe(true);
    expect(hasColumn(db, 'videos', 'format')).toBe(true);
    const row = db
      .query<{ format: string }, []>('SELECT format FROM videos WHERE verse_num = 1')
      .get();
    expect(row!.format).toBe('short');
    db.close();
  });

  it('creates idx_videos_format_status', () => {
    const db = buildOldShapeDb();
    applyYoutubeStateMigrations(db);
    const idx = db
      .query<{ n: number }, []>(
        "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='index' AND name='idx_videos_format_status'",
      )
      .get();
    expect(idx!.n).toBe(1);
    db.close();
  });

  it('adds audio_lang to video_analytics', () => {
    const db = buildOldShapeDb();
    const res = applyYoutubeStateMigrations(db);
    expect(res.audioLangAdded).toBe(true);
    expect(hasColumn(db, 'video_analytics', 'audio_lang')).toBe(true);
    db.close();
  });

  it('stamps PRAGMA user_version = 2', () => {
    const db = buildOldShapeDb();
    expect(userVersion(db)).toBe(0);
    applyYoutubeStateMigrations(db);
    expect(userVersion(db)).toBe(YOUTUBE_STATE_USER_VERSION);
    expect(YOUTUBE_STATE_USER_VERSION).toBe(2);
    db.close();
  });

  it('is idempotent on a second run (guards skip, no throw)', () => {
    const db = buildOldShapeDb();
    applyYoutubeStateMigrations(db);
    const res2 = applyYoutubeStateMigrations(db);
    expect(res2.formatAdded).toBe(false);
    expect(res2.audioLangAdded).toBe(false);
    expect(hasColumn(db, 'videos', 'format')).toBe(true);
    expect(userVersion(db)).toBe(2);
    // The pre-existing row survived both runs.
    const n = db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM videos').get();
    expect(n!.n).toBe(1);
    db.close();
  });

  it('the added CHECK rejects unknown formats', () => {
    const db = buildOldShapeDb();
    applyYoutubeStateMigrations(db);
    expect(() =>
      db.exec(
        "INSERT INTO videos (text_id, chapter, verse_num, lang, status, format) VALUES ('siva-sutras', 1, 2, 'en', 'pending', 'bogus')",
      ),
    ).toThrow();
    // 'chapter' (verse_num=0) is accepted.
    db.exec(
      "INSERT INTO videos (text_id, chapter, verse_num, lang, status, format) VALUES ('siva-sutras', 1, 0, 'en', 'pending', 'chapter')",
    );
    db.close();
  });
});

describe('applyYoutubeStateMigrations — fresh DB', () => {
  it('creates the full schema with format + audio_lang + stamp (no ALTERs)', () => {
    const db = new Database(':memory:');
    const res = applyYoutubeStateMigrations(db);
    // schema.sql itself carries the new columns — guards must not fire.
    expect(res.formatAdded).toBe(false);
    expect(res.audioLangAdded).toBe(false);
    expect(hasColumn(db, 'videos', 'format')).toBe(true);
    expect(hasColumn(db, 'video_analytics', 'audio_lang')).toBe(true);
    expect(userVersion(db)).toBe(2);
    db.close();
  });
});

describe('getVideosDb checkout-vs-DB guard', () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it('refuses a post-M0 stamp on a DB missing the format column', () => {
    dir = mkdtempSync(join(tmpdir(), 'yt-m0-guard-'));
    const path = join(dir, 'state.db');
    const setup = buildOldShapeDb(path);
    setup.exec('PRAGMA user_version = 2;'); // post-M0 stamp, pre-M0 shape
    setup.close();
    expect(() => getVideosDb(path)).toThrow(
      /post-M0 \(user_version 2\) but this checkout predates the format column/,
    );
  });

  it('opens a properly migrated DB', () => {
    dir = mkdtempSync(join(tmpdir(), 'yt-m0-guard-'));
    const path = join(dir, 'state.db');
    const setup = buildOldShapeDb(path);
    applyYoutubeStateMigrations(setup);
    setup.close();
    const db = getVideosDb(path);
    expect(hasColumn(db, 'videos', 'format')).toBe(true);
    db.close();
  });

  it('opens a pre-M0 DB that is not stamped (user_version 0)', () => {
    dir = mkdtempSync(join(tmpdir(), 'yt-m0-guard-'));
    const path = join(dir, 'state.db');
    buildOldShapeDb(path).close();
    const db = getVideosDb(path);
    expect(userVersion(db)).toBe(0);
    db.close();
  });
});
