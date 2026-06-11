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

// ─────────────────────────────────────────────────────────────────────────────
// Chapter-format fixtures (format='chapter', verse_num=0 rows)
// ─────────────────────────────────────────────────────────────────────────────

/** One corpus verse for a chapter fixture. translation=null → no row. */
export interface ChapterCorpusVerse {
  verse_num: number;
  devanagari: string;
  iast: string;
  /** Translation text; null → no translation row; '' → empty row (fail path). */
  translation: string | null;
  status?: 'draft' | 'reviewed' | 'published';
}

/** Multi-verse chapter fixture: spanda-karikas ch1, mixed statuses. */
export const SPANDA_CH1_VERSES: ChapterCorpusVerse[] = [
  {
    verse_num: 1,
    devanagari: 'यस्योन्मेषनिमेषाभ्यां जगतः प्रलयोदयौ',
    iast: 'yasyonmeṣanimeṣābhyāṁ jagataḥ pralayodayau',
    translation: 'By whose opening and closing of the eyes the world dissolves and arises.',
    status: 'published',
  },
  {
    verse_num: 2,
    devanagari: 'यत्र स्थितमिदं सर्वं कार्यं यस्माच्च निर्गतम्',
    iast: 'yatra sthitam idaṁ sarvaṁ kāryaṁ yasmāc ca nirgatam',
    translation: 'In whom all this creation rests and from whom it has come forth.',
    status: 'reviewed',
  },
  {
    verse_num: 3,
    devanagari: 'जाग्रदादिविभेदेऽपि तदभिन्ने प्रसर्पति',
    iast: "jāgradādivibhede 'pi tadabhinne prasarpati",
    translation: 'Even in the differentiation of waking and the rest, that remains undivided.',
    status: 'draft',
  },
];

/** 1-verse chapter fixture (the spanda ch4 shape). */
export const SPANDA_CH4_VERSES: ChapterCorpusVerse[] = [
  {
    verse_num: 1,
    devanagari: 'अगाधसंशयाम्भोधिसमुत्तरणतारिणीम्',
    iast: 'agādhasaṁśayāmbhodhisamuttaraṇatāriṇīm',
    translation: 'I revere that ferry which carries one across the unfathomable ocean of doubt.',
    status: 'reviewed',
  },
];

/**
 * Seed a chapter's corpus rows (text + verses + translations). Inserts the
 * 'spanda-karikas' text once (OR IGNORE). Returns the translation row id
 * per verse_num (null where no/empty translation was seeded).
 */
export function seedChapterCorpus(
  db: Database,
  opts: {
    textId?: string;
    chapter?: number;
    lang?: string;
    verses?: ChapterCorpusVerse[];
  } = {},
): { textId: string; chapter: number; translationRowIds: Map<number, number | null> } {
  const textId = opts.textId ?? 'spanda-karikas';
  const chapter = opts.chapter ?? 1;
  const lang = opts.lang ?? 'en';
  const verses = opts.verses ?? SPANDA_CH1_VERSES;

  db.query(
    `INSERT OR IGNORE INTO texts (id, slug, title_sa, title_en, title_iast, author, tradition, license)
     VALUES ($id, $id, 'स्पन्दकारिका', 'Spanda Karikas', 'Spandakārikā', 'Vasugupta', 'trika', 'CC-BY-4.0')`,
  ).run({ $id: textId });

  const translationRowIds = new Map<number, number | null>();
  for (const v of verses) {
    const vi = db
      .query(
        `INSERT INTO verses (text_id, chapter, verse_num, devanagari, iast)
         VALUES ($t, $c, $n, $d, $i)`,
      )
      .run({ $t: textId, $c: chapter, $n: v.verse_num, $d: v.devanagari, $i: v.iast });
    const verseId = Number(vi.lastInsertRowid);
    if (v.translation === null) {
      translationRowIds.set(v.verse_num, null);
      continue;
    }
    const ti = db
      .query(
        `INSERT INTO translations (verse_id, lang, translation_text, license, status)
         VALUES ($v, $l, $x, 'PD', $s)`,
      )
      .run({ $v: verseId, $l: lang, $x: v.translation, $s: v.status ?? 'reviewed' });
    translationRowIds.set(v.verse_num, Number(ti.lastInsertRowid));
  }
  return { textId, chapter, translationRowIds };
}

/** A NewVideoRow-shaped payload for a CHAPTER row (spanda-karikas ch1 en). */
export const SPANDA_CH1_CHAPTER_NEW = {
  text_id: 'spanda-karikas',
  chapter: 1,
  verse_num: 0, // chapter rows use 0 (corpus verses start at 1)
  lang: 'en',
  short_index: 0,
  format: 'chapter' as const,
  kula: 'trika',
  style_preset: 'trika-classic',
  translation_md5: 'md5-spanda-ch1-manifest',
  template_version: 'c1',
  tts_voice_id: 'en-US-Studio-O',
  translation_row_id: 1,
  remotion_version: '4.0.0',
  ffmpeg_version: 'ffmpeg-static',
};

/**
 * Insert a chapter `videos` row (defaults: SPANDA_CH1_CHAPTER_NEW, status
 * pending). Pass overrides for md5/translation_row_id/chapter/etc. Returns
 * the row id. NOTE: translation_row_id must reference a seeded translation
 * (FKs are ON) — seedChapterCorpus first.
 */
export function seedChapterVideo(
  db: Database,
  overrides: Partial<typeof SPANDA_CH1_CHAPTER_NEW> & { status?: string } = {},
): number {
  const row = { ...SPANDA_CH1_CHAPTER_NEW, status: 'pending', ...overrides };
  const info = db
    .query(
      `INSERT INTO videos (
         text_id, chapter, verse_num, lang, short_index, format, channel_handle,
         kula, style_preset, translation_md5, template_version,
         tts_voice_id, translation_row_id, remotion_version, ffmpeg_version, status
       ) VALUES (
         $text_id, $chapter, $verse_num, $lang, $short_index, $format, '@sohamhamso',
         $kula, $style_preset, $translation_md5, $template_version,
         $tts_voice_id, $translation_row_id, $remotion_version, $ffmpeg_version, $status
       )`,
    )
    .run({
      $text_id: row.text_id,
      $chapter: row.chapter,
      $verse_num: row.verse_num,
      $lang: row.lang,
      $short_index: row.short_index,
      $format: row.format,
      $kula: row.kula,
      $style_preset: row.style_preset,
      $translation_md5: row.translation_md5,
      $template_version: row.template_version,
      $tts_voice_id: row.tts_voice_id,
      $translation_row_id: row.translation_row_id,
      $remotion_version: row.remotion_version,
      $ffmpeg_version: row.ffmpeg_version,
      $status: row.status,
    });
  return Number(info.lastInsertRowid);
}

/** A canonical chapter `.meta.json` sidecar object (3 contiguous segments). */
export function makeChapterSidecar(
  overrides: Partial<{
    segments: Array<{
      verse_num: number;
      startS: number;
      durationS: number;
      translation_row_id: number;
      translation_md5: string;
    }>;
    durationS: number;
    verseCount: number;
    lang: string;
    voiceId: string;
    templateVersion: string;
    manifestMd5: string;
    outroStartS: number;
  }> = {},
) {
  const segments = overrides.segments ?? [
    { verse_num: 1, startS: 5, durationS: 10, translation_row_id: 1, translation_md5: 'm1' },
    { verse_num: 2, startS: 15, durationS: 10, translation_row_id: 2, translation_md5: 'm2' },
    { verse_num: 3, startS: 25, durationS: 10, translation_row_id: 3, translation_md5: 'm3' },
  ];
  return {
    segments,
    durationS: overrides.durationS ?? 44, // 5 title + 3×10 + 9 outro
    verseCount: overrides.verseCount ?? segments.length,
    lang: overrides.lang ?? 'en',
    voiceId: overrides.voiceId ?? 'en-US-Studio-O',
    templateVersion: overrides.templateVersion ?? 'c1',
    manifestMd5: overrides.manifestMd5 ?? 'md5-spanda-ch1-manifest',
    outroStartS: overrides.outroStartS ?? 35, // last verse end (durationS − 9s outro)
  };
}

/**
 * Deterministic synthetic per-verse narration durations (seconds) for
 * timing-math tests (45-verse siva-sutras ch3 / 163-verse VBT shapes):
 * 3.0–7.8s, varied but reproducible.
 */
export function syntheticNarrationDurationsS(n: number): number[] {
  return Array.from({ length: n }, (_, i) => 3 + ((i * 7) % 25) / 5.2);
}
