import type { LangCode } from '../reading-modes';
import { DEFAULT_LANG, absoluteChapterIndexUrl, absoluteLocaleUrl } from './i18n-routes';

export interface HreflangEntry {
  hreflang: LangCode | 'x-default';
  href: string;
}

function buildEntries(
  basePath: string,
  langs: Iterable<LangCode>,
  urlFor: (basePath: string, lang: string) => string,
): HreflangEntry[] {
  const unique = Array.from(new Set(langs));
  const entries: HreflangEntry[] = unique.map((lang) => ({
    hreflang: lang,
    href: urlFor(basePath, lang),
  }));
  entries.sort((a, b) => a.hreflang.localeCompare(b.hreflang));
  entries.push({
    hreflang: 'x-default',
    href: urlFor(basePath, DEFAULT_LANG),
  });
  return entries;
}

export function buildHreflangEntries(basePath: string, langs: Iterable<LangCode>): HreflangEntry[] {
  return buildEntries(basePath, langs, absoluteLocaleUrl);
}

/**
 * hreflang for chapter-index pages — localized alternates carry the trailing
 * slash CF Pages requires to serve the static asset (see chapterIndexPath).
 */
export function buildChapterIndexHreflangEntries(
  basePath: string,
  langs: Iterable<LangCode>,
): HreflangEntry[] {
  return buildEntries(basePath, langs, absoluteChapterIndexUrl);
}
