/**
 * _db-helpers.ts
 *
 * Shared throwaway-DB builder for the videos-table tests. Mirrors the
 * fixture pattern in tests/unit/dataset-publish.test.ts: build a fresh
 * sqlite from db/schema.sql and seed the FK parents (`texts`, `verses`,
 * `translations`) so `videos` inserts satisfy foreign keys.
 */
// biome-ignore lint/correctness/noUndeclaredDependencies: bun built-in
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const SCHEMA_PATH = resolve(REPO_ROOT, 'db', 'schema.sql');

/** A `NewVideoRow` payload for Siva Sutra 1.1 (the MVP verse). */
export const SIVA_1_1_NEW = {
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

/**
 * Build an in-memory DB from db/schema.sql, FK parents seeded. Returns the
 * open handle; caller closes it. `translation_row_id` 1 is the seeded
 * Siva Sutra 1.1 English translation.
 */
export function buildTempDb(): Database {
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
