import type { LangCode } from '../reading-modes';
import { liveLocaleSet, localePathFor } from './i18n-routes';

export const LOCALIZED_CHROME_BASE_PATHS = [
  '/texts',
  '/about/methodology',
  '/about/sources',
  '/about/license',
  '/about/privacy',
  '/about/colophon',
  '/dataset',
  '/donate',
  '/cite',
  '/daily',
] as const;

export const ENGLISH_ONLY_NOINDEX_CHROME_BASE_PATHS = [
  '/search',
  '/confirmed',
  '/unsubscribed',
  '/sample',
] as const;

export const CHROME_SITEMAP_BASE_PATHS = ['/', ...LOCALIZED_CHROME_BASE_PATHS] as const;

export function getChromeAvailableLangs(): LangCode[] {
  return Array.from(liveLocaleSet()).sort() as LangCode[];
}

export function isLocalizedChromeBasePath(basePath: string): boolean {
  return LOCALIZED_CHROME_BASE_PATHS.includes(
    basePath as (typeof LOCALIZED_CHROME_BASE_PATHS)[number],
  );
}

export function getChromeSitemapPaths(): string[] {
  const liveLangs = getChromeAvailableLangs();
  return CHROME_SITEMAP_BASE_PATHS.flatMap((basePath) =>
    basePath === '/' || isLocalizedChromeBasePath(basePath)
      ? liveLangs.map((lang) => localePathFor(basePath, lang))
      : [basePath],
  );
}
