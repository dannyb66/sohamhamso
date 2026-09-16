/**
 * videos-format-listing.test.ts
 *
 * Format plumbing in src/lib/videos-db.ts: insertPending defaults to
 * format='short' and stores an explicit 'chapter'; listByStatus with no
 * opts returns ALL formats (backward compatible) and filters when
 * `opts.format` is set; getLatestVideo honors `ident.format`;
 * countByStatusFormat groups per (format, status). Plus the
 * youtube-render.ts pickQueue compat guard: BOTH picks (pending AND
 * failed-with-retry-budget) are restricted to format='short' so chapter
 * rows never enter the shorts cron.
 *
 * Self-contained: builds its own schema.sql DB inline (no _db-helpers).
 */
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pickQueue } from '../../../scripts/youtube-render';
import { pickApprovedCandidates } from '../../../scripts/youtube-upload';
import {
  type NewVideoRow,
  countByStatusFormat,
  getLatestVideo,
  insertPending,
  listByStatus,
  updateVideoStatus,
} from '../../../src/lib/videos-db';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const SCHEMA_PATH = resolve(REPO_ROOT, 'db', 'schema.sql');

/** Base short payload (Siva Sutra 1.1 en). */
const SHORT_NEW: NewVideoRow = {
  text_id: 'siva-sutras',
  chapter: 1,
  verse_num: 1,
  lang: 'en',
  short_index: 0,
  kula: 'trika',
  style_preset: 'trika-classic',
  translation_md5: 'md5-siva-1-1',
  template_version: 'v2',
  tts_voice_id: 'en-US-Studio-O',
  translation_row_id: 1,
  remotion_version: '4.0.0',
  ffmpeg_version: 'ffmpeg-static',
};

/** Chapter payload for the same text — verse_num=0 by contract. */
const CHAPTER_NEW: NewVideoRow = {
  ...SHORT_NEW,
  verse_num: 0,
  format: 'chapter',
  translation_md5: 'md5-siva-ch1-manifest',
  template_version: 'c1',
};

/** Fresh in-memory DB from db/schema.sql, FK parents seeded. */
function buildTempDb(): Database {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(readFileSync(SCHEMA_PATH, 'utf8'));
  db.exec(`
    INSERT INTO texts (id, slug, title_sa, title_en, tradition, license)
    VALUES ('siva-sutras', 'siva-sutras', 'शिवसूत्राणि', 'Śiva Sūtras', 'trika', 'CC-BY-4.0');
  `);
  db.exec(`
    INSERT INTO verses (id, text_id, chapter, verse_num, devanagari, iast)
    VALUES (1, 'siva-sutras', 1, 1, 'चैतन्यमात्मा', 'caitanyam ātmā');
  `);
  db.exec(`
    INSERT INTO translations (id, verse_id, lang, translation_text, license, status)
    VALUES (1, 1, 'en', 'Consciousness is the Self.', 'PD', 'reviewed');
  `);
  return db;
}

let db: Database;
beforeEach(() => {
  db = buildTempDb();
});
afterEach(() => {
  db.close();
});

describe('insertPending format', () => {
  it('defaults to short when format is omitted', () => {
    insertPending(db, SHORT_NEW);
    const row = getLatestVideo(db, {
      text_id: 'siva-sutras',
      chapter: 1,
      verse_num: 1,
      lang: 'en',
      short_index: 0,
    });
    expect(row!.format).toBe('short');
  });

  it('stores an explicit chapter format (verse_num=0)', () => {
    insertPending(db, CHAPTER_NEW);
    const row = getLatestVideo(db, {
      text_id: 'siva-sutras',
      chapter: 1,
      verse_num: 0,
      lang: 'en',
      short_index: 0,
    });
    expect(row!.format).toBe('chapter');
    expect(row!.template_version).toBe('c1');
  });
});

describe('listByStatus format filtering', () => {
  beforeEach(() => {
    insertPending(db, SHORT_NEW);
    insertPending(db, CHAPTER_NEW);
  });

  it('no opts returns all formats (backward compatible)', () => {
    const rows = listByStatus(db, 'pending', 10);
    expect(rows).toHaveLength(2);
  });

  it('format: short returns only short rows', () => {
    const rows = listByStatus(db, 'pending', 10, { format: 'short' });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.format).toBe('short');
    expect(rows[0]!.verse_num).toBe(1);
  });

  it('format: chapter returns only chapter rows', () => {
    const rows = listByStatus(db, 'pending', 10, { format: 'chapter' });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.format).toBe('chapter');
    expect(rows[0]!.verse_num).toBe(0);
  });

  it('omitted limit returns all matching rows', () => {
    const rows = listByStatus(db, 'pending');
    expect(rows).toHaveLength(2);
  });

  it('format combines with the lang filter', () => {
    const rows = listByStatus(db, 'pending', 10, { lang: 'en', format: 'chapter' });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.format).toBe('chapter');
  });
});

describe('getLatestVideo format filter', () => {
  it('ident.format restricts the lookup', () => {
    insertPending(db, SHORT_NEW);
    insertPending(db, CHAPTER_NEW);
    const ident = { text_id: 'siva-sutras', chapter: 1, verse_num: 0, lang: 'en', short_index: 0 };
    expect(getLatestVideo(db, { ...ident, format: 'chapter' })!.format).toBe('chapter');
    expect(getLatestVideo(db, { ...ident, format: 'short' })).toBeNull();
  });
});

describe('countByStatusFormat', () => {
  it('groups counts per (format, status)', () => {
    const shortId = insertPending(db, SHORT_NEW);
    insertPending(db, { ...SHORT_NEW, translation_md5: 'md5-v2' });
    insertPending(db, CHAPTER_NEW);
    updateVideoStatus(db, shortId, 'rendered');

    const rows = countByStatusFormat(db);
    const get = (format: string, status: string) =>
      rows.find((r) => r.format === format && r.status === status)?.n ?? 0;
    expect(get('short', 'pending')).toBe(1);
    expect(get('short', 'rendered')).toBe(1);
    expect(get('chapter', 'pending')).toBe(1);
    expect(get('chapter', 'rendered')).toBe(0);
  });
});

describe('youtube-render pickQueue shorts-only compat guard', () => {
  it('excludes chapter rows from BOTH the pending and failed picks', () => {
    // pending: one short, one chapter
    insertPending(db, SHORT_NEW);
    insertPending(db, CHAPTER_NEW);
    // failed with retry budget: one short, one chapter
    const failedShort = insertPending(db, { ...SHORT_NEW, verse_num: 2 });
    updateVideoStatus(db, failedShort, 'failed', { retry_count: 1 });
    const failedChapter = insertPending(db, {
      ...CHAPTER_NEW,
      chapter: 2,
      translation_md5: 'md5-siva-ch2-manifest',
    });
    updateVideoStatus(db, failedChapter, 'failed', { retry_count: 1 });

    const queue = pickQueue(db, 10);
    expect(queue).toHaveLength(2); // pending short + failed short
    for (const row of queue) {
      expect(row.format).toBe('short');
      expect(row.verse_num).toBeGreaterThan(0);
    }
    const statuses = queue.map((r) => r.status).sort();
    expect(statuses).toEqual(['failed', 'pending']);
  });
});

describe('youtube-upload pickApprovedCandidates scoped uploads', () => {
  it('filters approved upload candidates by text and lang before applying the limit', () => {
    const hiId = insertPending(db, {
      ...SHORT_NEW,
      lang: 'hi',
      translation_md5: 'md5-siva-1-1-hi',
      tts_voice_id: 'hi-IN-Wavenet-A',
      status: 'approved',
    });
    updateVideoStatus(db, hiId, 'approved', { priority: 100 });
    const bnId = insertPending(db, {
      ...SHORT_NEW,
      lang: 'bn',
      translation_md5: 'md5-siva-1-1-bn',
      tts_voice_id: 'bn-IN-Wavenet-A',
      status: 'approved',
    });
    updateVideoStatus(db, bnId, 'approved', { priority: 90 });
    const enFirstId = insertPending(db, {
      ...SHORT_NEW,
      translation_md5: 'md5-siva-1-1-en-a',
      status: 'approved',
    });
    const enSecondId = insertPending(db, {
      ...SHORT_NEW,
      verse_num: 2,
      translation_md5: 'md5-siva-1-2-en',
      status: 'approved',
    });

    const rows = pickApprovedCandidates(db, 1, { textSlug: 'siva-sutras', lang: 'en' });

    expect(rows.map((r) => r.id)).toEqual([enFirstId, enSecondId]);
    expect(rows.every((r) => r.lang === 'en')).toBe(true);
  });

  it('accepts either text_id or texts.slug for text scoping', () => {
    db.exec(`
      INSERT INTO texts (id, slug, title_sa, title_en, tradition, license)
      VALUES ('siva-sutras-internal', 'siva-sutras-public', 'शिवसूत्राणि', 'Śiva Sūtras', 'trika', 'CC-BY-4.0');
    `);
    db.exec(`
      INSERT INTO verses (id, text_id, chapter, verse_num, devanagari, iast)
      VALUES (2, 'siva-sutras-internal', 1, 1, 'चैतन्यमात्मा', 'caitanyam ātmā');
    `);
    db.exec(`
      INSERT INTO translations (id, verse_id, lang, translation_text, license, status)
      VALUES (2, 2, 'en', 'Consciousness is the Self.', 'PD', 'reviewed');
    `);
    insertPending(db, { ...SHORT_NEW, status: 'approved' });
    const scopedId = insertPending(db, {
      ...SHORT_NEW,
      text_id: 'siva-sutras-internal',
      translation_md5: 'md5-public-slug',
      translation_row_id: 2,
      status: 'approved',
    });

    const bySlug = pickApprovedCandidates(db, 10, { textSlug: 'siva-sutras-public' });
    const byId = pickApprovedCandidates(db, 10, { textSlug: 'siva-sutras-internal' });

    expect(bySlug.map((r) => r.id)).toEqual([scopedId]);
    expect(byId.map((r) => r.id)).toEqual([scopedId]);
  });

  it('excludes already-uploaded rows even if their status is still approved', () => {
    const uploadedApprovedId = insertPending(db, {
      ...SHORT_NEW,
      translation_md5: 'md5-uploaded-approved',
      status: 'approved',
    });
    updateVideoStatus(db, uploadedApprovedId, 'approved', {
      youtube_video_id: 'yt-existing',
      youtube_url: 'https://www.youtube.com/watch?v=yt-existing',
    });
    const waitingId = insertPending(db, {
      ...SHORT_NEW,
      translation_md5: 'md5-waiting-approved',
      status: 'approved',
    });

    const rows = pickApprovedCandidates(db, 10, { textSlug: 'siva-sutras', lang: 'en' });

    expect(rows.map((r) => r.id)).toEqual([waitingId]);
  });
});
