import { READING_MODES, type LangCode } from '../reading-modes';

export const SITE_URL = 'https://sohamhamso.org';
export const DEFAULT_LANG: LangCode = 'en';
export const ALL_LANGS = READING_MODES.map((mode) => mode.langCode);
export const NON_ENGLISH_LANGS = ALL_LANGS.filter((lang): lang is Exclude<LangCode, 'en'> => lang !== 'en');

function normalizePath(pathname: string): string {
  if (!pathname || pathname === '/') return '/';
  const withSlash = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return withSlash.length > 1 ? withSlash.replace(/\/+$/, '') : withSlash;
}

export function isLangCode(value: string | undefined | null): value is LangCode {
  return typeof value === 'string' && ALL_LANGS.includes(value as LangCode);
}

export function localePathFor(basePath: string, lang: string): string {
  const normalized = normalizePath(basePath);
  if (!isLangCode(lang) || lang === DEFAULT_LANG) return normalized;
  return normalized === '/' ? `/${lang}` : `/${lang}${normalized}`;
}

export function stripLocalePrefix(pathname: string): { lang: LangCode; basePath: string } {
  const normalized = normalizePath(pathname);
  if (normalized === '/') return { lang: DEFAULT_LANG, basePath: '/' };
  const parts = normalized.split('/').filter(Boolean);
  const maybeLang = parts[0];
  if (!isLangCode(maybeLang) || maybeLang === DEFAULT_LANG) {
    return { lang: DEFAULT_LANG, basePath: normalized };
  }
  const rest = `/${parts.slice(1).join('/')}`;
  return {
    lang: maybeLang,
    basePath: rest === '/' ? '/' : normalizePath(rest),
  };
}

export function absoluteUrl(pathname: string): string {
  return new URL(localePathFor(pathname, DEFAULT_LANG), SITE_URL).toString();
}

export function absoluteLocaleUrl(basePath: string, lang: string): string {
  return new URL(localePathFor(basePath, lang), SITE_URL).toString();
}

/**
 * Map an internal LangCode to a BCP-47 tag suitable for JSON-LD
 * `inLanguage` on locale-specific page nodes (WebPage, Article, FAQPage,
 * DefinedTerm). Sanskrit `sa` (used on Book and Quotation source nodes)
 * is intentionally NOT routed through here — those describe the source
 * work, not the page locale, and have no region tag.
 *
 * Why `-IN` for non-English:
 *   - pa-IN vs pa-PK disambiguates Gurmukhi from Shahmukhi (this site
 *     only ships pa-IN Gurmukhi).
 *   - bn-IN vs bn-BD disambiguates the Indian Bengali register we
 *     translate into.
 *   - For other Indic langs the -IN suffix is conventionally redundant
 *     but harmless; using it uniformly keeps the rule one-liner.
 */
export function inLanguageTag(lang: LangCode): string {
  if (lang === 'en') return 'en';
  return `${lang}-IN`;
}

export function currentLangLabel(lang: string): string {
  return isLangCode(lang) ? lang.toUpperCase() : DEFAULT_LANG.toUpperCase();
}

function parseTruthy(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

export function localeUrlsLive(): boolean {
  return parseTruthy(process.env.LOCALE_URLS_LIVE);
}

export function liveLocaleSet(): Set<LangCode> {
  const configured = process.env.LOCALE_URLS_LIVE_LANGS
    ?.split(',')
    .map((part) => part.trim())
    .filter(isLangCode);
  const live = new Set<LangCode>([DEFAULT_LANG]);
  if (configured && configured.length > 0) {
    return new Set<LangCode>(configured.includes(DEFAULT_LANG) ? configured : [DEFAULT_LANG, ...configured]);
  }
  if (!localeUrlsLive()) return live;
  for (const lang of NON_ENGLISH_LANGS) live.add(lang);
  return live;
}

export function isLiveLocale(lang: LangCode): boolean {
  return liveLocaleSet().has(lang);
}
