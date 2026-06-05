import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { __setCorpusDirForTests, buildTextSeo, buildVerseSeo } from '../../../src/lib/seo';

const text = {
  id: 'siva-sutras',
  slug: 'siva-sutras',
  title_sa: 'शिवसूत्राणि',
  title_en: 'Śiva Sūtras',
  title_iast: 'Śivasūtrāṇi',
  author: 'Vasugupta',
  tradition: 'trika',
  school: 'kashmir-shaivism',
  era: null,
  source: null,
  source_url: null,
  source_revision: null,
  license: 'CC-BY 4.0',
  attribution_html: null,
  parent_text_id: null,
  manuscript_url: null,
  description: 'Default corpus description.',
} as const;

const verse = {
  id: 1,
  text_id: 'siva-sutras',
  book: null,
  chapter: 1,
  verse_num: 1,
  devanagari: 'चैतन्यमात्मा ॥१॥',
  slp1: null,
  iast: 'caitanyam ātmā',
  meter: 'sūtra',
  manuscript_folio_ref: null,
} as const;

let tempCorpusDir: string | null = null;

function writeCorpusFixture(): void {
  tempCorpusDir = mkdtempSync(join(tmpdir(), 'sohamhamso-seo-overrides-'));
  mkdirSync(tempCorpusDir, { recursive: true });
  writeFileSync(
    join(tempCorpusDir, 'siva-sutras.yaml'),
    `
schema_version: 1
faq_file: ./siva-sutras.faq.yaml
seo:
  schema_version: 1
  descriptions:
    en: "English override description."
    hi: "Hindi override description."
  keywords:
    en: [shiva sutras, consciousness]
    hi: [शिव सूत्र, चेतना]
  noindex_langs: [hi]
text:
  id: siva-sutras
  slug: siva-sutras
  title_sa: शिवसूत्राणि
  title_en: Śiva Sūtras
  tradition: trika
  license: PD
chapters:
  - chapter: 1
    verses:
      - verse: 1
        devanagari: "चैतन्यमात्मा ॥१॥"
        translations:
          - lang: en
            text: "Consciousness is the Self."
            license: PD
            status: published
`,
    'utf8',
  );
  writeFileSync(
    join(tempCorpusDir, 'siva-sutras.faq.yaml'),
    `
schema_version: 1
faqs:
  - question: "What is the Śiva Sūtras?"
    answer: "A compact Trika root text."
  - question:
      hi: "शिवसूत्र क्या है?"
    answer:
      hi: "एक संक्षिप्त त्रिक मूलग्रन्थ।"
`,
    'utf8',
  );
  __setCorpusDirForTests(tempCorpusDir);
}

afterEach(() => {
  __setCorpusDirForTests(null);
  if (tempCorpusDir) rmSync(tempCorpusDir, { force: true, recursive: true });
  tempCorpusDir = null;
});

describe('corpus SEO overrides', () => {
  it('applies description and keyword overrides and emits FAQPage JSON-LD', () => {
    writeCorpusFixture();

    const seo = buildTextSeo({
      availableLangs: ['en', 'hi', 'ta'],
      basePath: '/trika/siva-sutras',
      lang: 'en',
      text,
      totalVerses: 77,
    });

    expect(seo.description).toBe('English override description.');
    expect(seo.keywords).toEqual(['shiva sutras', 'consciousness']);
    expect(seo.hreflang.map((entry) => entry.hreflang)).toEqual(['en', 'ta', 'x-default']);

    const faqNode = seo.jsonLd.find((node) => node['@type'] === 'FAQPage');
    expect(faqNode).toBeTruthy();
    expect((faqNode?.mainEntity as Array<{ name: string }>)[0]?.name).toBe(
      'What is the Śiva Sūtras?',
    );
  });

  it('marks configured locales as noindex and removes them from verse hreflang clusters', () => {
    writeCorpusFixture();

    const localizedTextSeo = buildTextSeo({
      availableLangs: ['en', 'hi'],
      basePath: '/trika/siva-sutras',
      lang: 'hi',
      text,
      totalVerses: 77,
    });
    expect(localizedTextSeo.noindex).toBe(true);
    expect(localizedTextSeo.hreflang).toEqual([]);

    const verseSeo = buildVerseSeo({
      availableLangs: ['en', 'hi'],
      basePath: '/trika/siva-sutras/1/1',
      lang: 'en',
      text,
      translation: 'Consciousness is the Self.',
      verse,
    });
    expect(verseSeo.noindex).toBe(false);
    expect(verseSeo.hreflang.map((entry) => entry.hreflang)).toEqual(['en', 'x-default']);
  });
});
