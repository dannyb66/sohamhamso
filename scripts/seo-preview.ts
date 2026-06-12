#!/usr/bin/env bun
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  getAvailableLanguages,
  getText,
  getVerse,
  getVerseAllLanguages,
  listChapters,
} from '../src/lib/db';
import { READING_MODES, getReadingModeByLang } from '../src/lib/reading-modes';
import { type HreflangEntry, inspectHtmlFile, resolveSiteOrigin, toPageUrl } from './seo-validate';

export interface SeoPreview {
  source: 'db' | 'build';
  kind: 'text' | 'verse' | 'html';
  lang: string | null;
  routePath: string;
  url: string;
  canonical: string | null;
  title: string | null;
  description: string | null;
  robots: string | null;
  ogImage: string | null;
  hreflang: HreflangEntry[];
  jsonLd: unknown[];
  context: Record<string, unknown>;
}

interface PreviewArgs {
  text?: string;
  verse?: string;
  lang?: string;
  html?: string;
  distDir?: string;
  site?: string;
  json?: boolean;
}

function parseArgs(argv: string[]): PreviewArgs {
  const args: PreviewArgs = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [key, ...rest] = arg.slice(2).split('=');
    const value = rest.join('=');
    switch (key) {
      case 'text':
        args.text = value;
        break;
      case 'verse':
        args.verse = value;
        break;
      case 'lang':
        args.lang = value || 'en';
        break;
      case 'html':
        args.html = value;
        break;
      case 'dist':
      case 'dist-dir':
        args.distDir = value;
        break;
      case 'site':
        args.site = value;
        break;
      case 'json':
        args.json = true;
        break;
      default:
        break;
    }
  }
  return args;
}

function normalizeLang(lang?: string): string {
  return (lang ?? 'en').toLowerCase();
}

function parseVerseRef(verseRef: string): { chapter: number; verse: number } {
  const match = verseRef.trim().match(/^(\d+)[./:](\d+)$/);
  if (!match) {
    throw new Error(`Invalid --verse value "${verseRef}". Expected chapter.verse, e.g. 1.1`);
  }
  return { chapter: Number(match[1]), verse: Number(match[2]) };
}

function buildLocaleRoutePath(
  lang: string,
  tradition: string,
  textSlug: string,
  chapter?: number,
  verse?: number,
): string {
  const parts = [lang === 'en' ? null : lang, tradition, textSlug];
  if (chapter !== undefined) parts.push(String(chapter));
  if (verse !== undefined) parts.push(String(verse));
  return `/${parts.filter(Boolean).join('/')}`;
}

function summarizeText(input: string, maxLength: number): string {
  const clean = input.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function buildVerseTitle(textTitle: string, chapter: number, verse: number, lang: string): string {
  const langLabel = getReadingModeByLang(lang)?.englishName ?? lang.toUpperCase();
  const raw =
    lang === 'en'
      ? `${textTitle} ${chapter}.${verse} | sohamhamso verse guide`
      : `${textTitle} ${chapter}.${verse} in ${langLabel} | sohamhamso`;
  return summarizeText(raw, 60);
}

function buildTextTitle(textTitle: string, lang: string): string {
  const langLabel = getReadingModeByLang(lang)?.englishName ?? lang.toUpperCase();
  const raw =
    lang === 'en'
      ? `${textTitle} | sohamhamso text guide`
      : `${textTitle} in ${langLabel} | sohamhamso text guide`;
  return summarizeText(raw, 60);
}

function buildDescription(primary: string, fallback: string): string {
  const source = primary.trim().length > 0 ? primary : fallback;
  return summarizeText(source, 160);
}

function orderedLangs(langs: Iterable<string>): string[] {
  const available = new Set([...langs].map((lang) => lang.toLowerCase()));
  return READING_MODES.map((mode) => mode.langCode).filter((lang) => available.has(lang));
}

function buildHreflangCluster(
  langs: string[],
  siteOrigin: string,
  tradition: string,
  textSlug: string,
  chapter?: number,
  verse?: number,
): HreflangEntry[] {
  const entries = langs.map((lang) => {
    const routePath = buildLocaleRoutePath(lang, tradition, textSlug, chapter, verse);
    return {
      hrefLang: lang,
      href: toPageUrl(routePath, siteOrigin),
      url: toPageUrl(routePath, siteOrigin),
    };
  });

  const englishPath = buildLocaleRoutePath('en', tradition, textSlug, chapter, verse);
  entries.push({
    hrefLang: 'x-default',
    href: toPageUrl(englishPath, siteOrigin),
    url: toPageUrl(englishPath, siteOrigin),
  });

  return entries;
}

function buildBreadcrumbs(
  siteOrigin: string,
  entries: Array<{ name: string; path: string }>,
): {
  '@context': string;
  '@type': 'BreadcrumbList';
  itemListElement: Array<Record<string, unknown>>;
} {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: entries.map((entry, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: entry.name,
      item: toPageUrl(entry.path, siteOrigin),
    })),
  };
}

export function buildSeoPreviewFromDb(input: {
  textSlug: string;
  lang?: string;
  verse?: string;
  siteOrigin: string;
}): SeoPreview {
  const lang = normalizeLang(input.lang);
  const text = getText(input.textSlug);
  if (!text) {
    throw new Error(`Unknown text slug: ${input.textSlug}`);
  }

  if (input.verse) {
    const { chapter, verse } = parseVerseRef(input.verse);
    const versePage = getVerse(input.textSlug, chapter, verse, lang);
    if (!versePage) {
      throw new Error(`Verse not found: ${input.textSlug} ${chapter}.${verse}`);
    }
    const allLang = getVerseAllLanguages(input.textSlug, chapter, verse);
    const availableLangs = orderedLangs(
      Object.keys(allLang?.translations_by_lang ?? {}).concat('en'),
    );
    const primaryTranslation = versePage.translations[0]?.translation_text;
    const fallbackTranslation = getVerse(input.textSlug, chapter, verse, 'en')?.translations[0]
      ?.translation_text;
    const routePath = buildLocaleRoutePath(lang, text.tradition, input.textSlug, chapter, verse);
    const canonical = toPageUrl(routePath, input.siteOrigin);

    return {
      source: 'db',
      kind: 'verse',
      lang,
      routePath,
      url: canonical,
      canonical,
      title: buildVerseTitle(text.title_en, chapter, verse, lang),
      description: buildDescription(
        primaryTranslation ?? '',
        fallbackTranslation ??
          `${text.title_en} ${chapter}.${verse}. Sanskrit verse, translation, glossary, and context.`,
      ),
      robots: null,
      ogImage: toPageUrl(`/og${routePath}.png`, input.siteOrigin),
      hreflang: buildHreflangCluster(
        availableLangs,
        input.siteOrigin,
        text.tradition,
        input.textSlug,
        chapter,
        verse,
      ),
      jsonLd: [
        {
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: buildVerseTitle(text.title_en, chapter, verse, lang),
          inLanguage: lang,
          url: canonical,
          isPartOf: {
            '@type': 'CreativeWork',
            name: text.title_en,
            url: toPageUrl(
              buildLocaleRoutePath(lang, text.tradition, input.textSlug),
              input.siteOrigin,
            ),
          },
          description: buildDescription(
            primaryTranslation ?? '',
            fallbackTranslation ??
              `${text.title_en} ${chapter}.${verse}. Sanskrit verse, translation, glossary, and context.`,
          ),
        },
        buildBreadcrumbs(input.siteOrigin, [
          { name: 'Home', path: '/' },
          { name: text.tradition, path: `/${text.tradition}` },
          { name: text.title_en, path: buildLocaleRoutePath(lang, text.tradition, input.textSlug) },
          { name: `${chapter}.${verse}`, path: routePath },
        ]),
      ],
      context: {
        tradition: text.tradition,
        textTitle: text.title_en,
        devanagari: versePage.verse.devanagari,
        iast: versePage.verse.iast,
        translationLangRequested: lang,
        translationLangUsed: versePage.translations[0]?.lang ?? (fallbackTranslation ? 'en' : null),
        availableLangs,
        glossCount: versePage.wordGlosses.length,
      },
    };
  }

  const chapters = listChapters(input.textSlug);
  const routePath = buildLocaleRoutePath(lang, text.tradition, input.textSlug);
  const canonical = toPageUrl(routePath, input.siteOrigin);
  const availableLangs = orderedLangs(getAvailableLanguages());
  const description = buildDescription(
    text.description ?? '',
    `${text.title_en}. Sanskrit text overview with chapter index and reading context on sohamhamso.`,
  );

  return {
    source: 'db',
    kind: 'text',
    lang,
    routePath,
    url: canonical,
    canonical,
    title: buildTextTitle(text.title_en, lang),
    description,
    robots: null,
    ogImage: toPageUrl(`/og${routePath}.png`, input.siteOrigin),
    hreflang: buildHreflangCluster(
      availableLangs,
      input.siteOrigin,
      text.tradition,
      input.textSlug,
    ),
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: text.title_en,
        inLanguage: lang,
        url: canonical,
        description,
      },
      buildBreadcrumbs(input.siteOrigin, [
        { name: 'Home', path: '/' },
        { name: text.tradition, path: `/${text.tradition}` },
        { name: text.title_en, path: routePath },
      ]),
    ],
    context: {
      tradition: text.tradition,
      chapterCount: chapters.length,
      verseCount: chapters.reduce((total, chapter) => total + chapter.verse_count, 0),
      availableLangs,
    },
  };
}

export async function buildSeoPreviewFromHtml(input: {
  filePath: string;
  distDir: string;
  siteOrigin: string;
}): Promise<SeoPreview> {
  const report = await inspectHtmlFile(resolve(input.filePath), {
    distDir: resolve(input.distDir),
    siteOrigin: input.siteOrigin,
  });

  return {
    source: 'build',
    kind: 'html',
    lang: report.htmlLang,
    routePath: report.routePath,
    url: report.pageUrl,
    canonical: report.canonicalUrl,
    title: report.title,
    description: report.description,
    robots: report.robots,
    ogImage: report.ogImageUrl,
    hreflang: report.hreflangEntries,
    jsonLd: report.jsonLd.map((block) => block.parsed ?? { error: block.error, raw: block.raw }),
    context: {
      isRedirect: report.isRedirect,
      redirectTarget: report.redirectTargetHref,
      issues: report.issues,
      filePath: report.filePath,
      htmlPreview: readFileSync(report.filePath, 'utf8').slice(0, 500),
    },
  };
}

function formatPreview(preview: SeoPreview): string {
  return [
    `Source: ${preview.source}`,
    `Kind: ${preview.kind}`,
    `URL: ${preview.url}`,
    `Canonical: ${preview.canonical ?? 'n/a'}`,
    `Lang: ${preview.lang ?? 'n/a'}`,
    `Title: ${preview.title ?? 'n/a'}`,
    `Description: ${preview.description ?? 'n/a'}`,
    `OG Image: ${preview.ogImage ?? 'n/a'}`,
    `Robots: ${preview.robots ?? 'index,follow (default)'}`,
    '',
    'Hreflang:',
    ...(preview.hreflang.length > 0
      ? preview.hreflang.map((entry) => `- ${entry.hrefLang}: ${entry.url ?? entry.href}`)
      : ['- none']),
    '',
    'JSON-LD:',
    ...preview.jsonLd.map((block) => JSON.stringify(block, null, 2)),
    '',
    'Context:',
    JSON.stringify(preview.context, null, 2),
  ].join('\n');
}

export async function runSeoPreviewCli(argv = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv);
  const siteOrigin = await resolveSiteOrigin(args.site);

  let preview: SeoPreview;
  if (args.html) {
    preview = await buildSeoPreviewFromHtml({
      filePath: args.html,
      distDir: args.distDir ?? 'dist',
      siteOrigin,
    });
  } else if (args.text) {
    preview = buildSeoPreviewFromDb({
      textSlug: args.text,
      lang: args.lang ?? 'en',
      verse: args.verse,
      siteOrigin,
    });
  } else {
    throw new Error('Provide either --html=dist/path/to/page.html or --text=<slug>.');
  }

  if (args.json) {
    console.log(JSON.stringify(preview, null, 2));
  } else {
    console.log(formatPreview(preview));
  }

  return 0;
}

if (import.meta.main) {
  const exitCode = await runSeoPreviewCli();
  process.exit(exitCode);
}
