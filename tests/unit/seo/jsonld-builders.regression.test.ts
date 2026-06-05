import { describe, expect, it } from 'vitest';
import {
  buildBookJsonLd,
  buildOrganizationJsonLd,
  buildQuotationJsonLd,
  buildWebSiteJsonLd,
} from '../../../src/lib/seo/jsonld';

const text = {
  slug: 'vijnana-bhairava',
  title_en: 'Vijñāna Bhairava Tantra',
  title_sa: 'विज्ञान भैरव',
  title_iast: 'Vijñāna Bhairava',
  author: 'Anonymous',
  tradition: 'trika',
  license: 'CC-BY-SA 4.0',
};

const verse = {
  devanagari: 'श्रीदेव्युवाच',
  iast: 'śrīdevyuvāca',
  chapter: 1,
  verse_num: 1,
};

function assertJsonSerializable(node: unknown): Record<string, unknown> {
  const serialized = JSON.stringify(node);
  expect(typeof serialized).toBe('string');
  const parsed = JSON.parse(serialized) as Record<string, unknown>;
  return parsed;
}

describe('buildBookJsonLd', () => {
  it('produces a Book node with required schema.org fields', () => {
    const node = buildBookJsonLd({ text });
    const parsed = assertJsonSerializable(node);

    expect(parsed['@context']).toBe('https://schema.org');
    expect(parsed['@type']).toBe('Book');
    expect(parsed['@id']).toBe('https://sohamhamso.org/trika/vijnana-bhairava');
    expect(parsed.name).toBe('Vijñāna Bhairava Tantra');
    expect(parsed.alternateName).toEqual(['विज्ञान भैरव', 'Vijñāna Bhairava']);
    expect(parsed.author).toMatchObject({ '@type': 'Person', name: 'Anonymous' });
    expect(parsed.inLanguage).toBe('sa');
    expect(parsed.bookFormat).toBe('EBook');
    expect(parsed.isAccessibleForFree).toBe(true);
    expect(parsed.license).toBe('CC-BY-SA 4.0');
    expect(parsed.publisher).toMatchObject({
      '@type': 'Organization',
      name: 'sohamhamso',
      url: 'https://sohamhamso.org',
    });
  });

  it('falls back to the default CC-BY-SA license when absent', () => {
    const node = buildBookJsonLd({
      text: { slug: 'x', title_en: 'X', tradition: 'kaula' },
    });
    const parsed = assertJsonSerializable(node);
    expect(parsed.license).toBe('https://creativecommons.org/licenses/by-sa/4.0/');
    expect(parsed.author).toBeUndefined();
    expect(parsed.alternateName).toBeUndefined();
  });
});

describe('buildQuotationJsonLd', () => {
  it('includes Devanagari text and a citation referencing the parent Book', () => {
    const node = buildQuotationJsonLd({ verse, text });
    const parsed = assertJsonSerializable(node);

    expect(parsed['@context']).toBe('https://schema.org');
    expect(parsed['@type']).toBe('Quotation');
    expect(parsed.text).toBe('श्रीदेव्युवाच');
    expect(parsed.alternativeHeadline).toBe('śrīdevyuvāca');
    expect(parsed.inLanguage).toBe('sa');
    expect(parsed.citation).toBe('Vijñāna Bhairava Tantra 1.1');
    expect(parsed.isPartOf).toMatchObject({
      '@type': 'Book',
      name: 'Vijñāna Bhairava Tantra',
      '@id': 'https://sohamhamso.org/trika/vijnana-bhairava',
    });
  });

  it('falls back to IAST when Devanagari is missing', () => {
    const node = buildQuotationJsonLd({
      verse: { iast: 'śrīdevyuvāca', chapter: 2, verse_num: 5 },
      text,
    });
    const parsed = assertJsonSerializable(node);
    expect(parsed.text).toBe('śrīdevyuvāca');
    expect(parsed.citation).toBe('Vijñāna Bhairava Tantra 2.5');
  });
});

describe('buildWebSiteJsonLd', () => {
  it('emits a WebSite node with a SearchAction urlTemplate', () => {
    const node = buildWebSiteJsonLd();
    const parsed = assertJsonSerializable(node);

    expect(parsed['@context']).toBe('https://schema.org');
    expect(parsed['@type']).toBe('WebSite');
    expect(parsed['@id']).toBe('https://sohamhamso.org/#website');
    expect(parsed.url).toBe('https://sohamhamso.org');
    expect(parsed.name).toBe('sohamhamso');
    expect(Array.isArray(parsed.inLanguage)).toBe(true);

    const action = parsed.potentialAction as Record<string, unknown>;
    expect(action['@type']).toBe('SearchAction');
    const target = action.target as Record<string, unknown>;
    expect(target['@type']).toBe('EntryPoint');
    expect(target.urlTemplate).toBe('https://sohamhamso.org/search?q={search_term_string}');
    expect(action['query-input']).toBe('required name=search_term_string');
  });
});

describe('buildOrganizationJsonLd', () => {
  it('emits an Organization node with #organization @id', () => {
    const node = buildOrganizationJsonLd();
    const parsed = assertJsonSerializable(node);

    expect(parsed['@context']).toBe('https://schema.org');
    expect(parsed['@type']).toBe('Organization');
    expect(parsed['@id']).toBe('https://sohamhamso.org/#organization');
    expect(String(parsed['@id'])).toContain('#organization');
    expect(parsed.name).toBe('sohamhamso');
    expect(parsed.url).toBe('https://sohamhamso.org');
    expect(parsed.foundingDate).toBe('2026');
  });
});
