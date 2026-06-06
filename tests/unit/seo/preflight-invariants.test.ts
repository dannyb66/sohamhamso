import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runPreflightChecks } from '../../../scripts/seo-preflight-invariants';
import type { LangCode } from '../../../src/lib/reading-modes';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

let tempDir: string | null = null;

function makeTempCorpusDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), 'sohamhamso-preflight-'));
  mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

function writeYaml(dir: string, filename: string, content: string): void {
  writeFileSync(join(dir, filename), content, 'utf8');
}

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { force: true, recursive: true });
    tempDir = null;
  }
});

// A minimal valid corpus YAML with translations for the specified languages.
function minimalCorpusYaml(options: {
  slug?: string;
  noindexLangs?: string[];
  translationLangs?: string[];
}): string {
  const { slug = 'test-text', noindexLangs = [], translationLangs = ['en'] } = options;

  const noindexBlock =
    noindexLangs.length > 0
      ? `  noindex_langs: [${noindexLangs.join(', ')}]`
      : '  noindex_langs: []';

  const translationEntries = translationLangs
    .map(
      (lang) => `          - lang: ${lang}
            text: "Translation in ${lang}."
            license: PD
            status: published`,
    )
    .join('\n');

  return `schema_version: 1
seo:
  schema_version: 1
  descriptions: {}
  keywords: {}
${noindexBlock}
text:
  id: ${slug}
  slug: ${slug}
  title_sa: परीक्षाग्रन्थः
  title_en: Test Text
  tradition: trika
  license: PD
chapters:
  - chapter: 1
    verses:
      - verse: 1
        devanagari: परीक्षा ॥१॥
        translations:
${translationEntries}
`;
}

// Live locale set covering en + hi + bn for most tests.
const LIVE_EN_HI_BN = new Set<LangCode>(['en', 'hi', 'bn']);
const LIVE_EN_HI = new Set<LangCode>(['en', 'hi']);
const LIVE_EN_ONLY = new Set<LangCode>(['en']);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('seo-preflight-invariants: runPreflightChecks', () => {
  describe('noindex_langs invariant', () => {
    it('fails when noindex_langs contains a live locale (hi)', () => {
      const dir = makeTempCorpusDir();
      writeYaml(
        dir,
        'test-text.yaml',
        minimalCorpusYaml({
          noindexLangs: ['hi'],
          translationLangs: ['en', 'hi'],
        }),
      );

      const result = runPreflightChecks({ corpusDir: dir, liveLocales: LIVE_EN_HI });

      const noindexFailures = result.failures.filter((f) => f.kind === 'noindex_lang');
      expect(noindexFailures).toHaveLength(1);
      expect(noindexFailures[0]).toMatchObject({
        kind: 'noindex_lang',
        lang: 'hi',
        file: 'test-text.yaml',
      });
    });

    it('fails for each live locale listed in noindex_langs', () => {
      const dir = makeTempCorpusDir();
      writeYaml(
        dir,
        'test-text.yaml',
        minimalCorpusYaml({
          noindexLangs: ['hi', 'bn'],
          translationLangs: ['en', 'hi', 'bn'],
        }),
      );

      const result = runPreflightChecks({ corpusDir: dir, liveLocales: LIVE_EN_HI_BN });

      const noindexFailures = result.failures.filter((f) => f.kind === 'noindex_lang');
      expect(noindexFailures).toHaveLength(2);
      expect(noindexFailures.map((f) => f.lang).sort()).toEqual(['bn', 'hi']);
    });

    it('passes when noindex_langs lists a locale that is not live', () => {
      const dir = makeTempCorpusDir();
      // noindex_langs has 'bn' but only en + hi are live
      writeYaml(
        dir,
        'test-text.yaml',
        minimalCorpusYaml({
          noindexLangs: ['bn'],
          translationLangs: ['en', 'hi'],
        }),
      );

      const result = runPreflightChecks({ corpusDir: dir, liveLocales: LIVE_EN_HI });

      const noindexFailures = result.failures.filter((f) => f.kind === 'noindex_lang');
      expect(noindexFailures).toHaveLength(0);
    });
  });

  describe('missing_translation invariant', () => {
    it('fails when a verse lacks a Bengali translation for a live Bengali locale', () => {
      const dir = makeTempCorpusDir();
      // Only English translation provided; bn is live
      writeYaml(
        dir,
        'test-text.yaml',
        minimalCorpusYaml({
          translationLangs: ['en'],
        }),
      );

      const result = runPreflightChecks({ corpusDir: dir, liveLocales: LIVE_EN_HI_BN });

      const missingFailures = result.failures.filter(
        (f) => f.kind === 'missing_translation' && f.lang === 'bn',
      );
      expect(missingFailures).toHaveLength(1);
      expect(missingFailures[0]).toMatchObject({
        kind: 'missing_translation',
        lang: 'bn',
        file: 'test-text.yaml',
      });
    });

    it('fails when a verse lacks a Hindi translation for a live Hindi locale', () => {
      const dir = makeTempCorpusDir();
      writeYaml(
        dir,
        'test-text.yaml',
        minimalCorpusYaml({
          translationLangs: ['en', 'bn'], // hi missing
        }),
      );

      const result = runPreflightChecks({ corpusDir: dir, liveLocales: LIVE_EN_HI_BN });

      const missingHi = result.failures.filter(
        (f) => f.kind === 'missing_translation' && f.lang === 'hi',
      );
      expect(missingHi).toHaveLength(1);
    });

    it('does not fail for missing non-live locale translations', () => {
      const dir = makeTempCorpusDir();
      // Only English; hi is not live
      writeYaml(
        dir,
        'test-text.yaml',
        minimalCorpusYaml({
          translationLangs: ['en'],
        }),
      );

      const result = runPreflightChecks({ corpusDir: dir, liveLocales: LIVE_EN_ONLY });

      expect(result.failures).toHaveLength(0);
    });

    it('does not emit missing_translation failures for English (canonical source)', () => {
      const dir = makeTempCorpusDir();
      // All non-English live locales covered; English always present as source
      writeYaml(
        dir,
        'test-text.yaml',
        minimalCorpusYaml({
          translationLangs: ['en', 'hi'],
        }),
      );

      const result = runPreflightChecks({ corpusDir: dir, liveLocales: LIVE_EN_HI });

      expect(result.failures).toHaveLength(0);
    });
  });

  describe('clean corpus', () => {
    it('passes with no failures when all live locales have translations and no noindex_langs conflicts', () => {
      const dir = makeTempCorpusDir();
      writeYaml(
        dir,
        'text-a.yaml',
        minimalCorpusYaml({ slug: 'text-a', translationLangs: ['en', 'hi', 'bn'] }),
      );
      writeYaml(
        dir,
        'text-b.yaml',
        minimalCorpusYaml({ slug: 'text-b', translationLangs: ['en', 'hi', 'bn'] }),
      );

      const result = runPreflightChecks({ corpusDir: dir, liveLocales: LIVE_EN_HI_BN });

      expect(result.failures).toHaveLength(0);
      expect(result.textCount).toBe(2);
      expect(result.verseCount).toBe(2);
    });

    it('returns correct counts on pass', () => {
      const dir = makeTempCorpusDir();
      writeYaml(
        dir,
        'single.yaml',
        minimalCorpusYaml({ slug: 'single', translationLangs: ['en', 'hi'] }),
      );

      const result = runPreflightChecks({ corpusDir: dir, liveLocales: LIVE_EN_HI });

      expect(result.failures).toHaveLength(0);
      expect(result.textCount).toBe(1);
      expect(result.verseCount).toBe(1);
    });
  });

  describe('file filtering', () => {
    it('ignores _template.yaml and *.faq.yaml files', () => {
      const dir = makeTempCorpusDir();
      // Valid text
      writeYaml(
        dir,
        'real.yaml',
        minimalCorpusYaml({ slug: 'real', translationLangs: ['en', 'hi'] }),
      );
      // These should be skipped
      writeYaml(dir, '_template.yaml', 'schema_version: 1\ntext:\n  id: x\n');
      writeYaml(dir, 'real.faq.yaml', 'schema_version: 1\nfaqs: []\n');

      const result = runPreflightChecks({ corpusDir: dir, liveLocales: LIVE_EN_HI });

      expect(result.textCount).toBe(1);
    });

    it('processes an empty corpus directory without error', () => {
      const dir = makeTempCorpusDir();

      const result = runPreflightChecks({ corpusDir: dir, liveLocales: LIVE_EN_HI_BN });

      expect(result.failures).toHaveLength(0);
      expect(result.textCount).toBe(0);
      expect(result.verseCount).toBe(0);
    });
  });
});
