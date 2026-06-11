/**
 * render-flow.test.ts — MOCKED end-to-end DB lifecycle.
 *
 * Exercises the full videos lifecycle (pending → rendering → rendered →
 * approved → uploaded) for a Siva Sutra 1.1 row, driving it directly through
 * the videos-db functions. We do NOT call render-engine.ts / the Remotion +
 * TTS + R2 paths here — those need installed deps (remotion, @google-cloud,
 * googleapis) and run under MOCK_ALL in a separate harness.
 *
 * The throwaway DB is built from db/schema.sql with FK parents seeded, the
 * same pattern as the unit videos-table test.
 *
 * NOTE: the real TTS + Remotion + R2 end-to-end runs under MOCK_ALL once the
 * pipeline deps are installed (MOCK_ALL=true bun scripts/youtube-tts-smoke.ts
 * → real MP4 from canned WAV + canned image, zero secrets).
 */
// biome-ignore lint/correctness/noUndeclaredDependencies: bun built-in
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addQuotaUnits,
  countByStatus,
  getLatestVideo,
  getQuotaToday,
  insertPending,
  updateVideoStatus,
} from '../../../src/lib/videos-db';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const SCHEMA_PATH = resolve(REPO_ROOT, 'db', 'schema.sql');

const IDENT = { text_id: 'siva-sutras', chapter: 1, verse_num: 1, lang: 'en', short_index: 0 };

const SIVA_1_1_NEW = {
  text_id: 'siva-sutras',
  chapter: 1,
  verse_num: 1,
  lang: 'en',
  short_index: 0,
  kula: 'trika',
  style_preset: 'trika-classic',
  translation_md5: 'md5-siva-1-1',
  template_version: 'v1',
  tts_voice_id: 'en-US-Studio-O',
  translation_row_id: 1,
  remotion_version: '4.0.0',
  ffmpeg_version: 'ffmpeg-static',
};

function buildDb(): Database {
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
  db = buildDb();
});
afterEach(() => {
  db.close();
});

describe('mocked render→upload lifecycle (Siva Sutra 1.1)', () => {
  it('drives a row pending → rendering → rendered → approved → uploaded', () => {
    // 1. Backfill: a fresh pending row.
    const id = insertPending(db, SIVA_1_1_NEW);
    expect(getLatestVideo(db, IDENT)!.status).toBe('pending');

    // 2. Cron A claims it (lease stamped).
    updateVideoStatus(db, id, 'rendering', {
      rendering_lease_at: new Date().toISOString(),
    });
    expect(getLatestVideo(db, IDENT)!.status).toBe('rendering');

    // 3. Render completes — R2 key + sha256 + bytes recorded.
    updateVideoStatus(db, id, 'rendered', {
      r2_key: 'videos/siva-sutras/1/1/en/md5-siva-1-1.mp4',
      output_file_sha256: 'a'.repeat(64),
      output_bytes: 5_000_000,
      duration_s: 18,
      rendered_at: new Date().toISOString(),
    });
    const rendered = getLatestVideo(db, IDENT)!;
    expect(rendered.status).toBe('rendered');
    expect(rendered.r2_key).toBe('videos/siva-sutras/1/1/en/md5-siva-1-1.mp4');
    expect(rendered.output_bytes).toBe(5_000_000);

    // 4. QA passed → auto-approve.
    updateVideoStatus(db, id, 'approved', {
      approved_at: new Date().toISOString(),
      approved_by: 'cron-a-qa',
    });
    expect(getLatestVideo(db, IDENT)!.status).toBe('approved');

    // 5. Cron B uploads (unlisted) + records quota.
    updateVideoStatus(db, id, 'uploaded', {
      youtube_video_id: 'yt_abc123',
      youtube_url: 'https://youtu.be/yt_abc123',
      visibility: 'unlisted',
      uploaded_at: new Date().toISOString(),
    });
    addQuotaUnits(db, '@sohamhamso', '2026-06-09', 100, 1);

    const uploaded = getLatestVideo(db, IDENT)!;
    expect(uploaded.status).toBe('uploaded');
    expect(uploaded.youtube_video_id).toBe('yt_abc123');
    expect(uploaded.visibility).toBe('unlisted');

    const quota = getQuotaToday(db, '@sohamhamso', '2026-06-09');
    expect(quota!.units_spent).toBe(100);
    expect(quota!.uploads_count).toBe(1);

    // 6. Final tally: exactly one uploaded row, nothing left mid-flight.
    const counts = countByStatus(db);
    expect(counts.uploaded).toBe(1);
    expect(counts.pending).toBe(0);
    expect(counts.rendering).toBe(0);
    expect(counts.rendered).toBe(0);
    expect(counts.approved).toBe(0);
  });
});
