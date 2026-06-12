import type { LangCode } from '../reading-modes';
import { DEFAULT_LANG, absoluteLocaleUrl } from './i18n-routes';

export interface HreflangEntry {
  hreflang: LangCode | 'x-default';
  href: string;
}

export function buildHreflangEntries(basePath: string, langs: Iterable<LangCode>): HreflangEntry[] {
  const unique = Array.from(new Set(langs));
  const entries: HreflangEntry[] = unique.map((lang) => ({
    hreflang: lang,
    href: absoluteLocaleUrl(basePath, lang),
  }));
  entries.sort((a, b) => a.hreflang.localeCompare(b.hreflang));
  entries.push({
    hreflang: 'x-default',
    href: absoluteLocaleUrl(basePath, DEFAULT_LANG),
  });
  return entries;
}
