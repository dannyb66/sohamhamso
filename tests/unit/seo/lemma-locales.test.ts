import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type PageNode, checkHreflangGraph } from '../../../scripts/seo-hreflang-closure';
import { ALL_LANGS } from '../../../src/lib/seo/i18n-routes';
import { buildLemmaSeo } from '../../../src/lib/seo/metadata';

let db: Database;
let corpus: typeof import('../../../src/lib/seo/corpus-bundle');
let getLemmaSitemap: typeof import('../../../src/pages/sitemap-lemmas.xml').GET;
let resetDb: typeof import('../../../src/lib/db').__setDbForTests;

beforeAll(async () => {
  vi.resetModules();
  db = new Database(':memory:');
  db.exec(readFileSync(resolve('db/schema.sql'), 'utf8'));
  db.exec(`
    INSERT INTO texts (id, slug, title_sa, title_en, tradition, license)
    VALUES ('test', 'test', 'परीक्षा', 'Test', 'trika', 'PD');
    INSERT INTO verses (id, text_id, chapter, verse_num, devanagari, iast)
    VALUES (1, 'test', 1, 1, 'परीक्षा', 'parīkṣā'),
           (2, 'test', 1, 2, 'परीक्षा', 'parīkṣā'),
           (3, 'test', 1, 3, 'परीक्षा', 'parīkṣā');
  `);
  const insert = db.query(`INSERT INTO word_glosses
    (verse_id, word_idx, word_sa, lemma_iast, gloss_lang, gloss_text)
    VALUES (?, ?, 'परीक्षा', ?, ?, ?)`);
  for (const verseId of [1, 2, 3]) {
    for (const lang of ['en', 'hi']) insert.run(verseId, 0, 'tato', lang, 'then');
    for (const lang of ALL_LANGS) insert.run(verseId, 1, 'ātman', lang, 'self');
  }
  insert.run(1, 2, 'rare', 'en', 'rare');
  ({ __setDbForTests: resetDb } = await import('../../../src/lib/db'));
  resetDb(db);
  corpus = await import('../../../src/lib/seo/corpus-bundle');
  ({ GET: getLemmaSitemap } = await import('../../../src/pages/sitemap-lemmas.xml'));
  vi.stubEnv('LOCALE_URLS_LIVE', 'true');
  vi.stubEnv('LOCALE_URLS_LIVE_LANGS', undefined);
});

afterAll(() => {
  resetDb(null);
  db.close();
  vi.unstubAllEnvs();
});

describe('lemma locale availability', () => {
  it('generates localized routes only when that lemma has a gloss in the locale', () => {
    expect(corpus.getLemmaPageCached('tato', 'ta')?.glossLang).toBe('en');
    expect(corpus.getLemmaRoutes('ta')).toEqual([{ slug: 'atman' }]);
    expect(corpus.getLemmaRoutes('hi')).toEqual([{ slug: 'tato' }, { slug: 'atman' }]);
  });

  it('keeps the existing occurrence threshold and canonical English routes', () => {
    expect(corpus.getLemmaRoutes()).toEqual([{ slug: 'tato' }, { slug: 'atman' }]);
    expect(corpus.getLemmaRoutes('en')).toEqual(corpus.getLemmaRoutes());
  });

  it('omits unsupported locale URLs from the lemma sitemap', async () => {
    const xml = await getLemmaSitemap().text();
    expect(xml).toContain('/lemma/tato</loc>');
    expect(xml).toContain('/hi/lemma/tato</loc>');
    expect(xml).not.toContain('/ta/lemma/tato</loc>');
    expect(xml).toContain('/ta/lemma/atman</loc>');
  });

  it('makes generated lemma hreflang clusters reciprocal with partial locale coverage', () => {
    const graph = new Map<string, PageNode>();
    for (const lang of ALL_LANGS) {
      for (const { slug } of corpus.getLemmaRoutes(lang)) {
        const data = corpus.getLemmaPageCached(slug, lang);
        if (!data) throw new Error(`Missing lemma data: ${lang}/${slug}`);
        const seo = buildLemmaSeo({ ...data, basePath: `/lemma/${slug}`, lang });
        graph.set(seo.canonical, {
          canonicalUrl: seo.canonical,
          hreflangByHref: new Map(seo.hreflang.map((entry) => [entry.href, entry.hreflang])),
        });
      }
    }
    expect(checkHreflangGraph(graph)).toEqual([]);
    expect(graph.has('https://sohamhamso.org/ta/lemma/tato')).toBe(false);
  });
});
