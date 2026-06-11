/**
 * chapter-render-flow.test.ts — MOCK_ALL end-to-end chapter render.
 *
 * Drives a REAL pending chapter row through renderChapterOne with every
 * external dependency canned (MOCK_ALL=true: TTS → silent WAV, Remotion →
 * padded canned bytes, R2 → local workdir copies — see render-engine.ts /
 * chapter-render-engine.ts mock paths):
 *
 *   pending → renderChapterOne → approved, with
 *     - r2_key under chapters/<text_id>/<chapter>/<lang>/<manifestMd5>.mp4
 *     - the `.meta.json` sidecar written NEXT TO the mp4 (atomic pair)
 *     - sidecar segments carrying per-verse provenance + timestamps
 *
 * Plus the two non-failure exits:
 *   - stored md5 ≠ live chapterContentMd5(manifest) → row SUPERSEDED +
 *     result 'skipped' (NEVER the failed/retry loop — eng decision #21)
 *   - a verse missing its translation → failed WITH the verse ref named.
 *
 * Mirrors render-flow.test.ts's throwaway-DB pattern; the corpus singleton
 * is injected via __setDbForTests (the engine reads verses through getDb()).
 */
import type { Database } from 'bun:sqlite';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  type ChapterSidecar,
  mockR2Path,
  renderChapterOne,
  resolveChapterVerses,
} from '../../../pipeline/youtube/chapter-render-engine';
import type { YoutubeConfig } from '../../../pipeline/youtube/config';
import { chapterContentMd5 } from '../../../pipeline/youtube/determinism';
import { buildChapterR2Key, chapterMetaKey } from '../../../pipeline/youtube/filename';
import { __setDbForTests } from '../../../src/lib/db';
import { getLatestVideo } from '../../../src/lib/videos-db';
import {
  SPANDA_CH4_VERSES,
  buildTempDb,
  seedChapterCorpus,
  seedChapterVideo,
} from '../../unit/youtube/_db-helpers';

const VOICE = 'en-US-Studio-O';

/** Self-contained config — no dependence on data/youtube-config.yaml. */
const CFG: YoutubeConfig = {
  style_presets: {
    'trika-classic': {
      bg: '#0E1B2E',
      accent: '#C9A227',
      text: '#F5F1E8',
      headline_font: 'EB Garamond',
      body_font: 'EB Garamond',
      devanagari_font: 'Noto Serif Devanagari',
      footer_line: 'sohamhamso.org',
      ornament: 'none',
    },
  },
  texts: {
    'spanda-karikas': { kula: 'trika', style_preset: 'trika-classic', youtube_eligible: true },
  },
  voices: { en: { provider: 'google', voice_id: VOICE } },
  defaults: { channel_handle: '@sohamhamso', visibility: 'unlisted', fps: 30, duration_s: 20 },
  chapters: {
    langs: ['en'],
    fps: 30,
    title_card_s: 5,
    outro_s: 9,
    min_translation_status: 'draft',
    uploads_enabled: false,
    min_seg_s: 10,
    seg_lead_in_s: 1.2,
    seg_tail_s: 1.0,
    group_max_verses: 1,
    encode: 'cbr8',
  },
  forbidden_colors: [],
  forbidden_iconography: [],
};

const CHAPTER_IDENT = {
  text_id: 'spanda-karikas',
  chapter: 1,
  verse_num: 0,
  lang: 'en',
  short_index: 0,
  format: 'chapter' as const,
};

let prevMockAll: string | undefined;
let db: Database;
let workDir: string;

beforeAll(() => {
  prevMockAll = process.env.MOCK_ALL;
  process.env.MOCK_ALL = 'true';
});
afterAll(() => {
  // '' is not 'true' → isMockAll() false again (biome noDelete-friendly).
  process.env.MOCK_ALL = prevMockAll ?? '';
});

beforeEach(() => {
  db = buildTempDb();
  __setDbForTests(db); // the engine resolves verses through getDb()
  workDir = mkdtempSync(join(tmpdir(), 'yt-chapter-flow-'));
});
afterEach(() => {
  __setDbForTests(null);
  db.close();
  rmSync(workDir, { recursive: true, force: true });
});

describe('pending chapter row → renderChapterOne → approved (MOCK_ALL)', () => {
  it('approves the row with a chapters/ r2_key and writes the sidecar (atomic pair)', async () => {
    seedChapterCorpus(db); // ch1: 3 verses, statuses published/reviewed/draft
    const resolved = resolveChapterVerses(db, 'spanda-karikas', 1, 'en', 'draft', VOICE);
    expect(resolved.missing).toEqual([]);
    expect(resolved.manifest).toHaveLength(3);
    const manifestMd5 = chapterContentMd5(resolved.manifest);

    const id = seedChapterVideo(db, {
      translation_md5: manifestMd5,
      translation_row_id: resolved.manifest[0].translation_row_id,
    });
    const row = getLatestVideo(db, CHAPTER_IDENT);
    expect(row?.id).toBe(id);
    expect(row?.status).toBe('pending');

    const res = await renderChapterOne(db, row!, { cfg: CFG, workDir });
    expect(res.error).toBeUndefined();
    expect(res.status).toBe('approved');

    const expectedKey = buildChapterR2Key(
      { text_id: 'spanda-karikas', chapter: 1, lang: 'en' },
      manifestMd5,
    );
    expect(res.r2Key).toBe(expectedKey);

    const after = getLatestVideo(db, CHAPTER_IDENT)!;
    expect(after.status).toBe('approved');
    expect(after.r2_key).toBe(expectedKey);
    expect(after.r2_key!.startsWith('chapters/spanda-karikas/1/en/')).toBe(true);
    expect(after.approved_by).toBe('auto-qa');
    expect(after.output_bytes).toBeGreaterThan(5_000_000); // chapter QA floor
    // title 5s + 3 × 10s floored segments + outro 9s = 44s
    expect(after.duration_s).toBe(44);

    // ATOMIC PAIR: both the mp4 and the .meta.json sidecar landed in (mock) R2.
    expect(existsSync(mockR2Path(workDir, expectedKey))).toBe(true);
    const metaPath = mockR2Path(
      workDir,
      chapterMetaKey({ text_id: 'spanda-karikas', chapter: 1, lang: 'en' }, manifestMd5),
    );
    expect(existsSync(metaPath)).toBe(true);

    const sidecar = JSON.parse(readFileSync(metaPath, 'utf8')) as ChapterSidecar;
    expect(sidecar.verseCount).toBe(3);
    expect(sidecar.manifestMd5).toBe(manifestMd5);
    expect(sidecar.lang).toBe('en');
    expect(sidecar.voiceId).toBe(VOICE);
    expect(sidecar.templateVersion).toBe('c1');
    expect(sidecar.durationS).toBe(44);
    expect(sidecar.segments).toHaveLength(3);
    // Segments are contiguous, start after the title card, carry provenance.
    expect(sidecar.segments[0].startS).toBe(5);
    expect(sidecar.segments[1].startS).toBe(15);
    expect(sidecar.segments[2].startS).toBe(25);
    for (const [i, seg] of sidecar.segments.entries()) {
      expect(seg.verse_num).toBe(i + 1);
      expect(seg.durationS).toBe(10); // 1.2 + 2s mock narration + 1.0 → floored to min_seg_s
      expect(seg.translation_row_id).toBe(resolved.manifest[i].translation_row_id);
      expect(seg.translation_md5).toMatch(/^[0-9a-f]{32}$/);
    }
  });

  it('renders a 1-verse chapter (spanda ch4 shape)', async () => {
    seedChapterCorpus(db, { chapter: 4, verses: SPANDA_CH4_VERSES });
    const resolved = resolveChapterVerses(db, 'spanda-karikas', 4, 'en', 'draft', VOICE);
    const manifestMd5 = chapterContentMd5(resolved.manifest);
    seedChapterVideo(db, {
      chapter: 4,
      translation_md5: manifestMd5,
      translation_row_id: resolved.manifest[0].translation_row_id,
    });
    const row = getLatestVideo(db, { ...CHAPTER_IDENT, chapter: 4 })!;

    const res = await renderChapterOne(db, row, { cfg: CFG, workDir });
    expect(res.status).toBe('approved');
    const after = getLatestVideo(db, { ...CHAPTER_IDENT, chapter: 4 })!;
    expect(after.duration_s).toBe(24); // 5 + 10 + 9

    const sidecar = JSON.parse(
      readFileSync(
        mockR2Path(
          workDir,
          chapterMetaKey({ text_id: 'spanda-karikas', chapter: 4, lang: 'en' }, manifestMd5),
        ),
        'utf8',
      ),
    ) as ChapterSidecar;
    expect(sidecar.verseCount).toBe(1);
    expect(sidecar.segments).toHaveLength(1);
  });
});

describe('md5 mismatch → superseded + skipped (NEVER failed/retry)', () => {
  it('marks the row superseded(manual) and returns skipped without touching retry_count', async () => {
    seedChapterCorpus(db);
    const id = seedChapterVideo(db, {
      translation_md5: 'stale-md5-from-before-the-verse-edit',
      translation_row_id: 2,
    });
    const row = getLatestVideo(db, CHAPTER_IDENT)!;

    const res = await renderChapterOne(db, row, { cfg: CFG, workDir });
    expect(res.status).toBe('skipped');
    expect(res.error).toBeUndefined();

    const after = db
      .query<
        {
          status: string;
          superseded_action: string | null;
          retry_count: number | null;
          last_error: string | null;
        },
        [number]
      >('SELECT status, superseded_action, retry_count, last_error FROM videos WHERE id = ?')
      .get(id)!;
    expect(after.status).toBe('superseded');
    expect(after.superseded_action).toBe('manual');
    expect(after.retry_count ?? 0).toBe(0); // no retry burned
    expect(after.last_error).toBeNull(); // not an error path
  });
});

describe('missing translation → failed naming the verse', () => {
  it('fails with the verse ref in last_error (phase render, retry_count bumped)', async () => {
    seedChapterCorpus(db, {
      chapter: 7,
      verses: [
        {
          verse_num: 1,
          devanagari: 'अ',
          iast: 'a',
          translation: 'First verse has a translation.',
          status: 'reviewed',
        },
        { verse_num: 2, devanagari: 'ब', iast: 'ba', translation: null },
      ],
    });
    const id = seedChapterVideo(db, {
      chapter: 7,
      translation_md5: 'irrelevant',
      translation_row_id: 2,
    });
    const row = getLatestVideo(db, { ...CHAPTER_IDENT, chapter: 7 })!;

    const res = await renderChapterOne(db, row, { cfg: CFG, workDir });
    expect(res.status).toBe('failed');
    expect(res.error).toMatch(/missing\/empty translation/i);
    expect(res.error).toMatch(/spanda-karikas 7\.2/);

    const after = db
      .query<
        {
          status: string;
          last_error: string | null;
          last_error_phase: string | null;
          retry_count: number | null;
        },
        [number]
      >('SELECT status, last_error, last_error_phase, retry_count FROM videos WHERE id = ?')
      .get(id)!;
    expect(after.status).toBe('failed');
    expect(after.last_error).toMatch(/7\.2/);
    expect(after.last_error_phase).toBe('render');
    expect(after.retry_count).toBe(1);
  });
});
