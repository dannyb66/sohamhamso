/**
 * i18n runtime helpers.
 *
 * `loadDict(lang)` dynamically imports the per-language JSON dictionary
 * (`./hi.json`, `./ta.json`, …). The English dictionary is bundled
 * statically (it IS the SSR copy and the fallback for every missing key).
 *
 * `t(key, dict)` resolves a key against the loaded dict, falling back to
 * the English value. Never throws — a missing key in BOTH the target lang
 * and English returns the key string itself so the failure is visible
 * but doesn't blow up the page.
 *
 * This module is consumed by:
 *   - I18nSwap (Solid island) — calls `loadDict` on hydrate.
 *   - Any future SSR helper that wants type-safe key lookup.
 */
import { type I18nKey, en } from './en';

export type { I18nKey } from './en';
export { en } from './en';

/**
 * Set of language codes that ship a translation dictionary at runtime.
 * Mirrors src/lib/reading-modes.ts non-English entries. Updated when a
 * translation agent lands a new JSON file in this directory.
 */
const SUPPORTED_LANGS = new Set<string>([
  'hi',
  'mr',
  'bn',
  'as',
  'gu',
  'pa',
  'kn',
  'ml',
  'or',
  'ta',
  'te',
]);

/**
 * Load the translation dictionary for `lang`.
 *
 * - 'en' → returns the bundled EN dict directly (no fetch).
 * - Supported lang with a missing JSON file → falls back to EN.
 * - Unsupported lang → falls back to EN.
 *
 * The dynamic-import path is a static string template so Vite/Astro can
 * code-split each language's JSON into its own chunk. Each chunk only
 * loads when the user actually picks that language.
 */
export async function loadDict(lang: string): Promise<Record<string, string>> {
  if (lang === 'en' || !SUPPORTED_LANGS.has(lang)) {
    return en as unknown as Record<string, string>;
  }
  try {
    const mod = await import(`./${lang}.json`);
    const dict = (mod.default ?? mod) as Record<string, string>;
    return dict;
  } catch {
    // Missing JSON file (Phase B not landed yet) → fall back to EN.
    return en as unknown as Record<string, string>;
  }
}

/**
 * Resolve a key against a loaded dict with English fallback. Pure.
 * Returns the key string itself if neither dict nor EN contains the
 * key — a visible-but-non-fatal failure mode.
 */
export function t(key: I18nKey, dict: Record<string, string>): string {
  return dict[key] ?? (en as Readonly<Record<string, string>>)[key] ?? String(key);
}
