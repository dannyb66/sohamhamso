import type { LangCode } from './reading-modes';
import { type StaticAssets, readStaticVersePage } from './static-corpus-read';
import { staticLexicalSearch } from './static-search';

export type StaticCorpusHealthSample = {
  tradition: string;
  textSlug: string;
  chapter: number;
  verse: number;
  lang: LangCode;
};

type HealthCheck = {
  name: 'corpus_read' | 'search_read';
  ok: boolean;
  elapsedMs: number;
  message: string;
  details?: Record<string, unknown>;
};

export type StaticCorpusHealthReport = {
  ok: boolean;
  backend: 'static-assets';
  generatedAt: string;
  sample: StaticCorpusHealthSample;
  checks: HealthCheck[];
};

const DEFAULT_SAMPLE: StaticCorpusHealthSample = {
  tradition: 'trika',
  textSlug: 'siva-sutras',
  chapter: 1,
  verse: 1,
  lang: 'en',
};

async function timedCheck(
  name: HealthCheck['name'],
  run: () => Promise<Omit<HealthCheck, 'name' | 'elapsedMs'>>,
): Promise<HealthCheck> {
  const started = performance.now();
  try {
    return { name, ...(await run()), elapsedMs: Math.round(performance.now() - started) };
  } catch (error) {
    return {
      name,
      ok: false,
      elapsedMs: Math.round(performance.now() - started),
      message: error instanceof Error ? error.message : 'Unknown static corpus health failure.',
    };
  }
}

export async function runStaticCorpusHealthCheck(options: {
  assets: StaticAssets;
  baseUrl: URL;
  sample?: Partial<StaticCorpusHealthSample>;
  now?: Date;
}): Promise<StaticCorpusHealthReport> {
  const sample = { ...DEFAULT_SAMPLE, ...options.sample };
  let query = 'consciousness';

  const corpusRead = await timedCheck('corpus_read', async () => {
    const result = await readStaticVersePage(
      sample.textSlug,
      sample.chapter,
      sample.verse,
      sample.lang,
      { assets: options.assets, baseUrl: options.baseUrl },
    );
    if (!result?.bundle || result.bundle.text.tradition !== sample.tradition) {
      return {
        ok: false,
        message: 'Static corpus sample verse was not found.',
        details: {
          route: `${sample.tradition}/${sample.textSlug}/${sample.chapter}/${sample.verse}`,
        },
      };
    }
    query =
      result.bundle.translations[0]?.translation_text.split(/\s+/)[0] ||
      result.bundle.verse.iast?.split(/\s+/)[0] ||
      result.bundle.verse.devanagari;
    return {
      ok: true,
      message: 'Static manifest and chapter bundle are readable.',
      details: {
        texts: result.texts.length,
        verseId: result.bundle.verse.id,
        translations: result.bundle.allTranslations.length,
        glosses: Object.values(result.bundle.glossesByLang).reduce(
          (total, values) => total + values.length,
          0,
        ),
      },
    };
  });

  const searchRead = await timedCheck('search_read', async () => {
    const hits = await staticLexicalSearch(query, sample.lang, 1, {
      assets: options.assets,
      baseUrl: options.baseUrl,
    });
    if (!hits?.length) {
      return {
        ok: false,
        message: `Static search shard returned no result for probe "${query}".`,
        details: { query, lang: sample.lang },
      };
    }
    return {
      ok: true,
      message: 'Static search shard is readable.',
      details: { query, lang: sample.lang, firstVerseId: hits[0].verse_id },
    };
  });

  const checks = [corpusRead, searchRead];
  return {
    ok: checks.every((check) => check.ok),
    backend: 'static-assets',
    generatedAt: (options.now ?? new Date()).toISOString(),
    sample,
    checks,
  };
}
