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
  buildChapterMarkerLines,
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

function snapshotableMeta(meta: ReturnType<typeof buildChapterUploadMetadata>) {
  return {
    ...meta,
    snippet: {
      ...meta.snippet,
      description: meta.snippet.description.split('\n'),
    },
  };
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
    expect(snapshotableMeta(meta)).toMatchSnapshot();
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

/** Any Devanāgarī codepoint (U+0900–U+097F) — the hi/mr script. */
const DEVANAGARI = /[ऀ-ॿ]/;

describe('buildChapterUploadMetadata — per-language SEO localization (hi)', () => {
  /** Same fixture as MULTI_VERSE but Hindi channel + native Devanāgarī title. */
  const HI_ARGS = {
    ...MULTI_VERSE_ARGS,
    lang: 'hi',
    textTitleDevanagari: 'स्पन्दकारिका',
  };
  const meta = buildChapterUploadMetadata(HI_ARGS);

  it('title is in-language Devanāgarī with the chapter/verse chrome words', () => {
    expect(meta.snippet.title).toMatch(DEVANAGARI);
    // "स्पन्दकारिका अध्याय 2 — सभी 7 श्लोक": native title + अध्याय + सभी + श्लोक.
    expect(meta.snippet.title).toContain('अध्याय 2');
    expect(meta.snippet.title).toContain('श्लोक');
    expect(meta.snippet.title.length).toBeLessThanOrEqual(100);
    // Primary keyword (the native title) sits in the first ~40 chars.
    expect(meta.snippet.title.indexOf('स्पन्दकारिका')).toBeLessThan(40);
  });

  it('first tag is the exact in-language target keyword (Devanāgarī)', () => {
    expect(meta.snippet.tags[0]).toMatch(DEVANAGARI);
    expect(meta.snippet.tags[0]).toBe(meta.snippet.title);
    // Broad English topic tags still follow.
    expect(meta.snippet.tags).toContain('Kashmir Shaivism');
  });

  it('description first sentence carries the in-language keyword + native SEO clause', () => {
    // Summary is first; the keyword sentence is the searchable body line.
    expect(meta.snippet.description).toMatch(DEVANAGARI);
    expect(meta.snippet.description).toContain('अध्याय 2');
    // Native clause reused verbatim from the site's hi SEO template.
    expect(meta.snippet.description).toContain('शब्द-दर-शब्द हिन्दी अनुवाद');
  });

  it('still carries the timestamp block, UTM canonical URL, and attribution', () => {
    expect(meta.snippet.description).toContain('0:00 ');
    expect(meta.snippet.description).toContain('0:12 Verse 1');
    expect(meta.snippet.description).toContain(
      'https://sohamhamso.org/trika/spanda-karikas/2?utm_source=youtube&utm_medium=chapter&utm_campaign=chapter',
    );
    expect(meta.snippet.description).toContain('CC-BY-SA 4.0');
    expect(meta.snippet.description).toContain('Muktabodha');
  });

  it('stamps hi on defaultLanguage + defaultAudioLanguage', () => {
    expect(meta.snippet.defaultLanguage).toBe('hi');
    expect(meta.snippet.defaultAudioLanguage).toBe('hi');
  });

  it('falls back to the IAST title when no Devanāgarī title is supplied (still localized chrome)', () => {
    const noDeva = buildChapterUploadMetadata({ ...MULTI_VERSE_ARGS, lang: 'hi' });
    expect(noDeva.snippet.title).toContain('Spandakārikā');
    expect(noDeva.snippet.title).toContain('अध्याय 2'); // chrome words still localized
  });
});

describe('buildChapterUploadMetadata — English output is unchanged (byte-identical)', () => {
  it('en title/tags/description match the legacy English shape exactly', () => {
    const meta = buildChapterUploadMetadata(MULTI_VERSE_ARGS);
    expect(meta.snippet.title).toBe('Spandakārikā — Chapter 2 | All 7 Verses');
    expect(meta.snippet.tags[0]).toBe('Kashmir Shaivism'); // NO leading localized tag
    expect(meta.snippet.tags).not.toContainEqual(expect.stringMatching(DEVANAGARI));
    expect(meta.snippet.description).toContain(
      'Spandakārikā — Chapter 2: all 7 verses with Devanāgarī, IAST and English translation,',
    );
    // The full English snapshot below is the authoritative byte-identity guard.
    expect(snapshotableMeta(meta)).toMatchSnapshot();
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

/**
 * buildChapterMarkerLines — short sutras grouped into ≥10s YouTube chapter
 * markers (`group_max_verses`). Every emitted marker MUST be ≥10s after the
 * previous one (incl. the implicit 0:00 title), or YouTube drops the whole
 * chapter list.
 */
describe('buildChapterMarkerLines (verse grouping)', () => {
  /** All gaps ≥10s past the marker start → no marker exceeds ≥10s spacing. */
  const gapsOk = (markers: Array<{ startS: number }>): boolean => {
    const ts = [0, ...markers.map((m) => m.startS)];
    return ts.slice(1).every((t, i) => t - ts[i] >= 10);
  };

  it('groups short (<10s) verses up to the cap and keeps every marker ≥10s apart', () => {
    // siva-sutras-style: ~4–6s segments starting at 5s after the title card.
    const segs = [5, 9, 13, 19, 27, 32, 38, 44, 50, 56].map((startS, i) => ({
      verseNum: i + 1,
      startS,
    }));
    const markers = buildChapterMarkerLines(segs, 3);
    expect(gapsOk(markers)).toBe(true);
    // Leading verses that start <10s in fold under the 0:00 title (no marker).
    expect(markers[0].firstVerse).toBeGreaterThan(1);
    // No group exceeds the cap of 3 verses.
    for (const m of markers) expect(m.lastVerse - m.firstVerse + 1).toBeLessThanOrEqual(3);
  });

  it('leaves long (≥10s) verses as single-verse markers', () => {
    const segs = [12, 34, 58, 81].map((startS, i) => ({ verseNum: i + 1, startS }));
    const markers = buildChapterMarkerLines(segs, 3);
    expect(gapsOk(markers)).toBe(true);
    expect(markers.every((m) => m.firstVerse === m.lastVerse)).toBe(true);
    expect(markers.map((m) => m.firstVerse)).toEqual([1, 2, 3, 4]);
  });

  it('honors a cap of 2 (never folds 3 verses into one marker)', () => {
    const segs = [5, 8, 11, 14, 22, 30].map((startS, i) => ({ verseNum: i + 1, startS }));
    const markers = buildChapterMarkerLines(segs, 2);
    for (const m of markers) expect(m.lastVerse - m.firstVerse + 1).toBeLessThanOrEqual(2);
    expect(gapsOk(markers)).toBe(true);
  });

  it('1-verse chapter starting <10s in yields no verse marker (folds under title)', () => {
    const markers = buildChapterMarkerLines([{ verseNum: 1, startS: 5 }], 3);
    expect(markers).toEqual([]);
  });
});
