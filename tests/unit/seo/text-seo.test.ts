import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { __setCorpusDirForTests, buildTextSeo, buildVerseSeo } from '../../../src/lib/seo';

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

const verse = {
  id: 1,
  text_id: 'test-text',
  book: null,
  chapter: 1,
  verse_num: 1,
  devanagari: 'परीक्षा',
  slp1: null,
  iast: 'pariksa',
  meter: null,
  manuscript_folio_ref: null,
} as const;

let fixtureDir: string | null = null;

function writeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sohamhamso-seo-'));
  writeFileSync(
    join(dir, 'test-text.yaml'),
    `schema_version: 1
faq_file: ./test-text.faq.yaml
seo:
  descriptions:
    en: Custom English description for Test Text.
    hi: परीक्षण पाठ का स्थानीय विवरण।
  keywords:
    en:
      - Test Text
      - Tantra Reader
  noindex_langs: [hi]
text:
  id: test-text
  slug: test-text
  title_sa: परीक्षा
  title_en: Test Text
  title_iast: Pariksa
  tradition: trika
  license: CC-BY 4.0
chapters:
  - chapter: 1
    verses:
      - verse: 1
        devanagari: परीक्षा
`,
  );
  writeFileSync(
    join(dir, 'test-text.faq.yaml'),
    `schema_version: 1
faqs:
  - question:
      en: What is Test Text?
    answer:
      en: A fixture used for SEO tests.
`,
  );
  return dir;
}

afterEach(() => {
  __setCorpusDirForTests(null);
  if (fixtureDir) {
    rmSync(fixtureDir, { force: true, recursive: true });
    fixtureDir = null;
  }
});

describe('text SEO overrides', () => {
  it('applies description, keywords, FAQ JSON-LD, and filtered hreflang on indexable text pages', () => {
    fixtureDir = writeFixture();
    __setCorpusDirForTests(fixtureDir);

    const seo = buildTextSeo({
      availableLangs: ['en', 'hi', 'ta'],
      basePath: '/trika/test-text',
      lang: 'en',
      text,
      totalVerses: 12,
    });

    expect(seo.description).toBe('Custom English description for Test Text.');
    expect(seo.keywords).toEqual(['Test Text', 'Tantra Reader']);
    expect(seo.noindex).toBe(false);
    expect(seo.hreflang.map((entry) => entry.hreflang)).toEqual(['en', 'ta', 'x-default']);

    const faqPage = seo.jsonLd.find((node) => node['@type'] === 'FAQPage');
    expect(faqPage).toBeTruthy();
    expect(faqPage).toMatchObject({
      '@type': 'FAQPage',
      inLanguage: 'en',
      url: 'https://sohamhamso.org/trika/test-text',
    });
  });

  it('marks configured localized text variants as noindex and suppresses hreflang', () => {
    fixtureDir = writeFixture();
    __setCorpusDirForTests(fixtureDir);

    const seo = buildTextSeo({
      availableLangs: ['en', 'hi', 'ta'],
      basePath: '/trika/test-text',
      lang: 'hi',
      indexable: true,
      text,
      totalVerses: 12,
    });

    expect(seo.description).toBe('परीक्षण पाठ का स्थानीय विवरण।');
    expect(seo.noindex).toBe(true);
    expect(seo.hreflang).toEqual([]);
  });

  it('removes noindexed locales from verse hreflang clusters for the same text', () => {
    fixtureDir = writeFixture();
    __setCorpusDirForTests(fixtureDir);

    const seo = buildVerseSeo({
      availableLangs: ['en', 'hi', 'ta'],
      basePath: '/trika/test-text/1/1',
      lang: 'en',
      text,
      translation: 'Fixture translation.',
      verse,
    });

    expect(seo.noindex).toBe(false);
    expect(seo.hreflang.map((entry) => entry.hreflang)).toEqual(['en', 'ta', 'x-default']);
  });
});
