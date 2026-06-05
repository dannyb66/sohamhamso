import { describe, expect, it } from 'vitest';
import type { LangCode } from '../../../src/lib/reading-modes';
import {
  resolveTextDescription,
  resolveVerseDescription,
} from '../../../src/lib/seo/descriptions';

const text = {
  id: 'test-text',
  slug: 'test-text',
  title_sa: 'परीक्षा',
  title_en: 'Test Text',
  title_iast: 'Pariksa',
  author: 'Test Author',
  tradition: 'trika',
  school: null,
  era: null,
  source: null,
  source_url: null,
  source_revision: null,
  license: 'CC-BY 4.0',
  attribution_html: null,
  parent_text_id: null,
  manuscript_url: null,
  description: null,
} as const;

const LOCALES: ReadonlyArray<{
  lang: LangCode;
  match: RegExp;
  label: string;
}> = [
  { lang: 'en', match: /verses/i, label: 'English contains "verses"' },
  { lang: 'hi', match: /[ऀ-ॿ]/, label: 'Devanāgarī (Hindi)' },
  { lang: 'mr', match: /[ऀ-ॿ]/, label: 'Devanāgarī (Marathi)' },
  { lang: 'ta', match: /[஀-௿]/, label: 'Tamil block' },
  { lang: 'te', match: /[ఀ-౿]/, label: 'Telugu block' },
  { lang: 'bn', match: /[ঀ-৿]/, label: 'Bengali block' },
  { lang: 'as', match: /[ঀ-৿]/, label: 'Bengali block (Assamese)' },
  { lang: 'gu', match: /[઀-૿]/, label: 'Gujarati block' },
  { lang: 'kn', match: /[ಀ-೿]/, label: 'Kannada block' },
  { lang: 'ml', match: /[ഀ-ൿ]/, label: 'Malayalam block' },
  { lang: 'pa', match: /[਀-੿]/, label: 'Gurmukhi block' },
  { lang: 'or', match: /[଀-୿]/, label: 'Odia block' },
];

describe('resolveTextDescription — native-script regression', () => {
  for (const locale of LOCALES) {
    it(`${locale.lang}: ${locale.label}`, () => {
      const out = resolveTextDescription({ lang: locale.lang, text, totalVerses: 42 });
      expect(out).toMatch(locale.match);
      expect(out.length).toBeGreaterThan(0);
    });
  }
});

describe('resolveVerseDescription — null translation noindex signal', () => {
  for (const locale of LOCALES) {
    it(`${locale.lang}: returns null when translation is null`, () => {
      const out = resolveVerseDescription({
        lang: locale.lang,
        text,
        chapter: 1,
        verseNum: 1,
        translation: null,
      });
      expect(out).toBeNull();
    });
  }
});
