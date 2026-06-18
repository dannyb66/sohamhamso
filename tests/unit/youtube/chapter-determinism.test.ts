/**
 * chapter-determinism.test.ts
 *
 * `chapterContentMd5` hashes a chapter's full provenance MANIFEST (not just
 * the text tuples — eng decision #17): any verse edit, row swap, voice
 * change, OR reordering must change the hash and therefore cascade a
 * chapter re-render via `shouldSkipRender`. The existing per-verse
 * `translationMd5` contract is untouched.
 */
import { describe, expect, it } from 'vitest';
import {
  type ChapterManifestEntry,
  chapterContentMd5,
  translationMd5,
} from '../../../pipeline/youtube/determinism';

function entry(overrides: Partial<ChapterManifestEntry> = {}): ChapterManifestEntry {
  return {
    verse_num: 1,
    devanagari: 'चैतन्यमात्मा',
    iast: 'caitanyam ātmā',
    translation_text: 'Consciousness is the Self.',
    translation_row_id: 101,
    tts_voice_id: 'en-US-Studio-O',
    ...overrides,
  };
}

const MANIFEST: ChapterManifestEntry[] = [
  entry(),
  entry({
    verse_num: 2,
    devanagari: 'ज्ञानं बन्धः',
    iast: 'jñānaṃ bandhaḥ',
    translation_text: 'Limited knowledge is bondage.',
    translation_row_id: 102,
  }),
];

describe('chapterContentMd5', () => {
  it('is a stable 32-hex md5 for the same manifest', () => {
    expect(chapterContentMd5(MANIFEST)).toMatch(/^[0-9a-f]{32}$/);
    expect(chapterContentMd5(MANIFEST)).toBe(chapterContentMd5(MANIFEST.map((e) => ({ ...e }))));
  });

  it('changes when ANY verse translation is edited', () => {
    const edited = [MANIFEST[0], { ...MANIFEST[1], translation_text: 'Knowledge is bondage.' }];
    expect(chapterContentMd5(edited)).not.toBe(chapterContentMd5(MANIFEST));
  });

  it('changes when a verse devanagari/iast line is edited', () => {
    expect(chapterContentMd5([{ ...MANIFEST[0], devanagari: 'चैतन्यमात्मा।' }, MANIFEST[1]])).not.toBe(
      chapterContentMd5(MANIFEST),
    );
    expect(chapterContentMd5([{ ...MANIFEST[0], iast: 'caitanyam-ātmā' }, MANIFEST[1]])).not.toBe(
      chapterContentMd5(MANIFEST),
    );
  });

  it('is order-sensitive (md5 of the array IN GIVEN ORDER)', () => {
    const reversed = [...MANIFEST].reverse();
    expect(chapterContentMd5(reversed)).not.toBe(chapterContentMd5(MANIFEST));
  });

  it('changes when a translation ROW is swapped (same text, different row id)', () => {
    const rowSwap = [MANIFEST[0], { ...MANIFEST[1], translation_row_id: 999 }];
    expect(chapterContentMd5(rowSwap)).not.toBe(chapterContentMd5(MANIFEST));
  });

  it('changes when the TTS voice changes (narration is part of the artifact)', () => {
    const voiceSwap = MANIFEST.map((e) => ({ ...e, tts_voice_id: 'en-US-Studio-Q' }));
    expect(chapterContentMd5(voiceSwap)).not.toBe(chapterContentMd5(MANIFEST));
  });

  it('changes when a verse is added or removed', () => {
    expect(chapterContentMd5([MANIFEST[0]])).not.toBe(chapterContentMd5(MANIFEST));
    expect(
      chapterContentMd5([
        ...MANIFEST,
        entry({
          verse_num: 3,
          translation_text: 'The group of powers...',
          translation_row_id: 103,
        }),
      ]),
    ).not.toBe(chapterContentMd5(MANIFEST));
  });
});

describe('translationMd5 — existing shorts contract untouched', () => {
  it('still hashes bare translation text deterministically', () => {
    const t = 'Consciousness is the Self.';
    expect(translationMd5(t)).toMatch(/^[0-9a-f]{32}$/);
    expect(translationMd5(t)).toBe(translationMd5(t));
    expect(translationMd5(t)).not.toBe(translationMd5(`${t} `));
  });

  it('is NOT the same function as chapterContentMd5 (different domains)', () => {
    const t = 'Consciousness is the Self.';
    expect(translationMd5(t)).not.toBe(chapterContentMd5([entry({ translation_text: t })]));
  });
});
