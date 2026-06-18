/**
 * chapter-upload-metadata.test.ts
 *
 * `buildChapterUploadMetadata` (format 2 — 16:9 full-chapter videos) follows
 * the post-1f46ffb SEO house style: front-loaded summary, searchable
 * IAST/Devanāgarī, keyword line, UTM canonical CTA, a YouTube-chapter
 * timestamp block (0:00 first, ascending, ≥3 lines even for a 1-verse
 * chapter), tight hashtags WITHOUT #Shorts, and the non-negotiable
 * CC-BY-SA/Muktabodha attribution. `<`/`>` are stripped from title and
 * description (YouTube rejects angle brackets) in BOTH builders.
 *
 * Fixtures are self-contained (no _db-helpers.ts dependency).
 */
import { describe, expect, it } from 'vitest';
import {
  buildChapterUploadMetadata,
  buildUploadMetadata,
} from '../../../pipeline/youtube/upload-metadata';

/** spanda-karikas ch2 style fixture — 7 verses, ≥10s apart, title card first. */
const MULTI_VERSE_ARGS = {
  textTitle: 'Spandakārikā',
  chapter: 2,
  verseCount: 7,
  lang: 'en',
  tradition: 'trika',
  textSlug: 'spanda-karikas',
  summary: 'Grasping that pulsation, the yogi rests in his own nature.',
  iast: 'tadākramya balaṃ mantrāḥ',
  devanagari: 'तदाक्रम्य बलं मन्त्राः',
  segments: [
    { verseNum: 1, startS: 12 },
    { verseNum: 2, startS: 34 },
    { verseNum: 3, startS: 58 },
    { verseNum: 4, startS: 81 },
    { verseNum: 5, startS: 104 },
    { verseNum: 6, startS: 130 },
    { verseNum: 7, startS: 155 },
  ],
  outroStartS: 178,
};

/** spanda-karikas ch4 — the corpus's only 1-verse chapter (singular grammar). */
const ONE_VERSE_ARGS = {
  textTitle: 'Spandakārikā',
  chapter: 4,
  verseCount: 1,
  lang: 'en',
  tradition: 'trika',
  textSlug: 'spanda-karikas',
  summary: 'I revere that wondrous speech of the master.',
  segments: [{ verseNum: 1, startS: 12 }],
  outroStartS: 30,
};

/** Lines that parse as YouTube timestamps (`M:SS …` or `H:MM:SS …`). */
function timestampLines(description: string): string[] {
  return description.split('\n').filter((l) => /^(?:\d+:)?\d+:\d{2} /.test(l));
}

/** Seconds value of a timestamp line. */
function parseStartS(line: string): number {
  const stamp = line.split(' ')[0];
  const parts = stamp.split(':').map(Number);
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

describe('buildChapterUploadMetadata — multi-verse chapter', () => {
  const meta = buildChapterUploadMetadata(MULTI_VERSE_ARGS);
  const lines = timestampLines(meta.snippet.description);

  it('title follows "{textTitle} — Chapter {N} | All {count} Verses" and stays ≤100 chars', () => {
    expect(meta.snippet.title).toBe('Spandakārikā — Chapter 2 | All 7 Verses');
    expect(meta.snippet.title.length).toBeLessThanOrEqual(100);
  });

  it('first timestamp line is 0:00 with the chapter title', () => {
    expect(lines[0]).toBe('0:00 Spandakārikā — Chapter 2');
  });

  it('emits one "M:SS Verse N" line per sidecar segment plus an outro line', () => {
    expect(lines).toHaveLength(1 + 7 + 1); // title + verses + outro
    expect(lines[1]).toBe('0:12 Verse 1');
    expect(lines[7]).toBe('2:35 Verse 7');
    expect(lines[8]).toMatch(/^2:58 /); // outro at 178s
  });

  it('timestamps ascend and sit ≥10s apart (YouTube chapter contract)', () => {
    const starts = lines.map(parseStartS);
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(10);
    }
  });

  it('formats ≥1h timestamps as H:MM:SS', () => {
    const long = buildChapterUploadMetadata({
      ...MULTI_VERSE_ARGS,
      segments: [
        { verseNum: 1, startS: 12 },
        { verseNum: 2, startS: 3725 }, // 1:02:05
      ],
      outroStartS: 3740,
    });
    expect(long.snippet.description).toContain('1:02:05 Verse 2');
  });

  it('description contains the canonical CHAPTER-PAGE URL with tradition segment + UTM', () => {
    expect(meta.snippet.description).toContain(
      'https://sohamhamso.org/trika/spanda-karikas/2?utm_source=youtube&utm_medium=chapter&utm_campaign=chapter',
    );
  });

  it('front-loads the chapter summary as the first description line', () => {
    expect(meta.snippet.description.startsWith(MULTI_VERSE_ARGS.summary)).toBe(true);
  });

  it('carries the searchable IAST + Devanāgarī lines', () => {
    expect(meta.snippet.description).toContain('tadākramya balaṃ mantrāḥ');
    expect(meta.snippet.description).toContain('तदाक्रम्य बलं मन्त्राः');
  });

  it('carries the CC-BY-SA / Muktabodha attribution block', () => {
    expect(meta.snippet.description).toContain('CC-BY-SA 4.0');
    expect(meta.snippet.description).toContain('Muktabodha');
  });

  it('has NO #shorts hashtag and fewer than 15 hashtags', () => {
    expect(meta.snippet.description).not.toMatch(/#shorts/i);
    const hashtags = meta.snippet.description.match(/#[A-Za-z0-9]+/g) ?? [];
    expect(hashtags.length).toBeGreaterThan(0);
    expect(hashtags.length).toBeLessThan(15);
  });

  it('stamps lang on defaultLanguage + defaultAudioLanguage and defaults to unlisted', () => {
    expect(meta.snippet.defaultLanguage).toBe('en');
    expect(meta.snippet.defaultAudioLanguage).toBe('en');
    expect(meta.status.privacyStatus).toBe('unlisted');
  });

  it('is deterministic for a fixed input (snapshot)', () => {
    expect(meta).toMatchSnapshot();
  });
});

describe('buildChapterUploadMetadata — 1-verse chapter (spanda ch4)', () => {
  const meta = buildChapterUploadMetadata(ONE_VERSE_ARGS);
  const lines = timestampLines(meta.snippet.description);

  it('uses singular grammar — "Verse 1", never "All 1 Verses"', () => {
    expect(meta.snippet.title).toBe('Spandakārikā — Chapter 4 | Verse 1');
    expect(meta.snippet.title).not.toContain('All 1 Verses');
    expect(meta.snippet.description).not.toContain('all 1 verses');
  });

  it('still emits ≥3 timestamp lines (title + verse + outro)', () => {
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines[0]).toMatch(/^0:00 /);
    expect(lines[1]).toBe('0:12 Verse 1');
    expect(lines[2]).toMatch(/^0:30 /);
  });
});

describe('buildChapterUploadMetadata — guards & sanitization', () => {
  it('throws on empty segments (never upload a chapter without timestamps)', () => {
    expect(() => buildChapterUploadMetadata({ ...MULTI_VERSE_ARGS, segments: [] })).toThrow(
      /timestamps/,
    );
  });

  it('strips < and > from title and description', () => {
    const meta = buildChapterUploadMetadata({
      ...MULTI_VERSE_ARGS,
      textTitle: 'Spanda <Kārikā>',
      summary: 'The <b>pulse</b> of awareness > all else.',
    });
    expect(meta.snippet.title).not.toMatch(/[<>]/);
    expect(meta.snippet.description).not.toMatch(/[<>]/);
    expect(meta.snippet.title).toContain('Spanda Kārikā');
  });
});

describe('buildUploadMetadata — shared <> sanitization (latent shorts fix)', () => {
  it('strips < and > from the shorts title and description too', () => {
    const meta = buildUploadMetadata({
      textTitle: 'Śiva Sūtra',
      chapter: 1,
      verseNum: 1,
      lang: 'en',
      translation: 'Consciousness <is> the Self.',
      canonicalUrl: 'https://sohamhamso.org/trika/siva-sutras/1/1',
    });
    expect(meta.snippet.title).not.toMatch(/[<>]/);
    expect(meta.snippet.description).not.toMatch(/[<>]/);
    expect(meta.snippet.description).toContain('Consciousness is the Self.');
  });
});
