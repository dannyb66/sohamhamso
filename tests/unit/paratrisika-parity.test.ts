// Parity regression — Paratrīśikā (slug `paratrisika`), Wave-1 QA Lane 3.
//
// Paratrīśikā was sourced (Sanskrit-only corpus) then translated/glossed
// into 12 languages and merged into data/corpus/paratrisika.yaml. This gate
// pins the structural shape the reader + SSR routes depend on, mirroring
// the Phase-1 baseline texts (siva-sutras, spanda-karikas, etc.):
//
//   - exactly 36 verses (one chapter)
//   - every verse carries exactly 12 published translations, and the lang
//     set is the canonical {en + 11 Indic}
//   - word_idx alignment holds: each verse's per-lang gloss JSON files
//     (data/glosses/paratrisika/*.json) expose a contiguous 0..N-1 word_idx
//     run whose length equals the corpus `word_glosses` count for that verse
//   - no `[draft]` bracket-tag leaks anywhere in the merged corpus, the
//     per-lang translation files, or the per-lang gloss files
//
// Run with: `bun --bun vitest run tests/unit/paratrisika-parity.test.ts`

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { load as yamlLoad } from 'js-yaml';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..', '..');
const CORPUS_PATH = join(ROOT, 'data', 'corpus', 'paratrisika.yaml');
const TRANSLATIONS_DIR = join(ROOT, 'data', 'translations', 'paratrisika');
const GLOSSES_DIR = join(ROOT, 'data', 'glosses', 'paratrisika');

const EXPECTED_VERSES = 36;
// 12 langs: English + the 11 Indic targets. English ships inside the corpus
// YAML translations[]; the 11 Indic langs also have standalone JSON files.
const EXPECTED_LANGS = ['en', 'as', 'bn', 'gu', 'hi', 'kn', 'ml', 'mr', 'or', 'pa', 'ta', 'te'];
const INDIC_LANGS = EXPECTED_LANGS.filter((l) => l !== 'en');
const DRAFT_MARKER = /\[draft\]/i;

interface WordGloss {
  word: string;
  iast?: string;
  [k: string]: unknown;
}
interface Translation {
  lang: string;
  text: string;
  status: string;
  [k: string]: unknown;
}
interface Verse {
  verse: number;
  word_glosses: WordGloss[];
  translations: Translation[];
}
interface Chapter {
  chapter: number;
  verses: Verse[];
}
interface Corpus {
  chapters: Chapter[];
}

const corpus = yamlLoad(readFileSync(CORPUS_PATH, 'utf8')) as Corpus;
const verses: Verse[] = corpus.chapters.flatMap((c) => c.verses);

/** "chapter.verse" key, matching the gloss/translation JSON verse keys. */
function verseKey(chapterNum: number, verseNum: number): string {
  return `${chapterNum}.${verseNum}`;
}

describe('Paratrīśikā parity — corpus shape', () => {
  it('has exactly 36 verses across its chapters', () => {
    expect(verses.length).toBe(EXPECTED_VERSES);
  });

  it('every verse carries exactly 12 translations', () => {
    for (const v of verses) {
      expect(v.translations.length, `verse ${v.verse} translation count`).toBe(
        EXPECTED_LANGS.length,
      );
    }
  });

  it('every verse exposes the canonical 12-lang set (en + 11 Indic), no dupes', () => {
    for (const v of verses) {
      const langs = v.translations.map((t) => t.lang).sort();
      expect(langs, `verse ${v.verse} langs`).toEqual([...EXPECTED_LANGS].sort());
    }
  });

  it('every translation is published (no draft/empty status leaks)', () => {
    for (const v of verses) {
      for (const t of v.translations) {
        expect(t.status, `verse ${v.verse} lang ${t.lang} status`).toBe('published');
        expect(typeof t.text === 'string' && t.text.trim().length > 0).toBe(true);
      }
    }
  });
});

describe('Paratrīśikā parity — word_idx alignment', () => {
  // Per-lang gloss JSON files key word entries by word_idx; that idx must be
  // a contiguous 0..N-1 run whose length equals the corpus word_glosses
  // count for the same verse, for every Indic lang. This is the alignment
  // the reader relies on to pair a word with its per-lang gloss.
  for (const lang of INDIC_LANGS) {
    it(`gloss file ${lang}.json aligns word_idx with corpus word_glosses`, () => {
      const payload = JSON.parse(
        readFileSync(join(GLOSSES_DIR, `${lang}.json`), 'utf8'),
      ) as { verses: Record<string, Array<{ word_idx: number }>> };

      for (const v of verses) {
        const key = verseKey(1, v.verse);
        const expectedCount = v.word_glosses.length;
        const entries = payload.verses[key];
        expect(entries, `${lang} verse ${key} present`).toBeDefined();
        const idxs = entries.map((e) => e.word_idx);
        // contiguous 0..N-1
        expect(idxs, `${lang} verse ${key} word_idx run`).toEqual(
          Array.from({ length: expectedCount }, (_, i) => i),
        );
      }
    });
  }
});

describe('Paratrīśikā parity — no [draft] leak', () => {
  it('corpus YAML carries no [draft] bracket-tag', () => {
    expect(DRAFT_MARKER.test(readFileSync(CORPUS_PATH, 'utf8'))).toBe(false);
  });

  it('per-lang translation + gloss JSON files carry no [draft] bracket-tag', () => {
    for (const dir of [TRANSLATIONS_DIR, GLOSSES_DIR]) {
      for (const name of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
        const raw = readFileSync(join(dir, name), 'utf8');
        expect(DRAFT_MARKER.test(raw), `${dir}/${name}`).toBe(false);
      }
    }
  });
});
