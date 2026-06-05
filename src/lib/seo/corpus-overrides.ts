import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as yamlLoad } from 'js-yaml';
import type { LangCode } from '../reading-modes';
import {
  parseCorpusDocument,
  parseCorpusFaqDocument,
  type CorpusFaqDocument,
  type CorpusFaqEntry,
} from './corpus-schema';

export interface ResolvedFaqEntry {
  answer: string;
  question: string;
}

interface LoadedCorpusSeoConfig {
  descriptions: Partial<Record<LangCode, string>>;
  faqEntries: CorpusFaqEntry[];
  keywords: Partial<Record<LangCode, string[]>>;
  noindexLangs: Set<LangCode>;
}

export interface TextSeoOverrides {
  description?: string;
  faqEntries: ResolvedFaqEntry[];
  keywords?: string[];
  noindex: boolean;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let corpusDirOverride: string | null = null;
let loaded = false;
const overridesBySlug = new Map<string, LoadedCorpusSeoConfig>();

function corpusDir(): string {
  if (corpusDirOverride) return corpusDirOverride;
  if (process.env.SOHAMHAMSO_CORPUS_DIR) return process.env.SOHAMHAMSO_CORPUS_DIR;
  const cwdPath = resolve(process.cwd(), 'data', 'corpus');
  if (existsSync(cwdPath)) return cwdPath;
  return resolve(__dirname, '..', '..', '..', 'data', 'corpus');
}

function isCorpusSourceFile(name: string): boolean {
  return /\.(ya?ml)$/i.test(name) && !/\.faq\.ya?ml$/i.test(name) && !name.startsWith('_');
}

function loadYamlDocument(filePath: string): unknown {
  const raw = readFileSync(filePath, 'utf8');
  const parsed = yamlLoad(raw);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`${filePath}: YAML root is not an object`);
  }
  return parsed;
}

function loadFaqDocument(corpusFilePath: string, faqFile: string): CorpusFaqDocument {
  const faqPath = resolve(dirname(corpusFilePath), faqFile);
  if (!existsSync(faqPath)) {
    throw new Error(`${corpusFilePath}: faq_file not found: ${faqFile}`);
  }
  return parseCorpusFaqDocument(loadYamlDocument(faqPath));
}

function resolveFaqEntries(entries: CorpusFaqEntry[], lang: LangCode): ResolvedFaqEntry[] {
  return entries.flatMap((entry) => {
    const question = entry.question[lang];
    const answer = entry.answer[lang];
    if (!question || !answer) return [];
    return [{ answer, question }];
  });
}

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  overridesBySlug.clear();

  const dir = corpusDir();
  if (!existsSync(dir)) return;

  for (const name of readdirSync(dir).sort()) {
    if (!isCorpusSourceFile(name)) continue;
    const filePath = resolve(dir, name);
    const document = parseCorpusDocument(loadYamlDocument(filePath));
    if (overridesBySlug.has(document.text.slug)) {
      throw new Error(`Duplicate corpus slug for SEO overrides: ${document.text.slug}`);
    }
    const faqEntries = document.faq_file
      ? loadFaqDocument(filePath, document.faq_file).faqs
      : [];
    const seo = document.seo ?? {
      descriptions: {},
      keywords: {},
      noindex_langs: [],
    };
    overridesBySlug.set(document.text.slug, {
      descriptions: seo.descriptions,
      faqEntries,
      keywords: seo.keywords,
      noindexLangs: new Set(seo.noindex_langs),
    });
  }
}

export function __setCorpusDirForTests(dir: string | null): void {
  corpusDirOverride = dir;
  loaded = false;
  overridesBySlug.clear();
}

export function getTextSeoOverrides(slug: string, lang: LangCode): TextSeoOverrides {
  ensureLoaded();
  const config = overridesBySlug.get(slug);
  if (!config) {
    return {
      faqEntries: [],
      noindex: false,
    };
  }

  return {
    description: config.descriptions[lang],
    faqEntries: resolveFaqEntries(config.faqEntries, lang),
    keywords: config.keywords[lang],
    noindex: lang !== 'en' && config.noindexLangs.has(lang),
  };
}

export function filterIndexableTextLangs(slug: string, langs: LangCode[]): LangCode[] {
  ensureLoaded();
  const config = overridesBySlug.get(slug);
  if (!config) return langs;
  return langs.filter((lang) => lang === 'en' || !config.noindexLangs.has(lang));
}
