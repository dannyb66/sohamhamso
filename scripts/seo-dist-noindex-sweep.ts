#!/usr/bin/env bun
/**
 * seo-dist-noindex-sweep.ts
 *
 * Walks all HTML files under dist/ and asserts that pages belonging to live
 * locales (as reported by liveLocaleSet()) do NOT carry a noindex robots tag.
 *
 * Exit 0 — no violations found; prints a locale → file-count matrix.
 * Exit 1 — at least one violation found; prints failures as a JSON array.
 *
 * Run: bun scripts/seo-dist-noindex-sweep.ts
 */

import { relative, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { collectHtmlFiles, inferRoutePath } from './seo-validate';
import { ALL_LANGS, isLangCode, liveLocaleSet } from '../src/lib/seo/i18n-routes';

const DIST_DIR = resolve('dist');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type UrlKind = 'verse' | 'text' | 'lemma' | 'homepage' | 'other';

interface NoindexFailure {
  path: string;
  locale: string;
  kind: UrlKind;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Derive locale from a relative path inside dist/.
 *  dist/index.html           → en
 *  dist/about/index.html     → en   (not a lang code)
 *  dist/hi/trika/...         → hi
 *  dist/lemma/foo/index.html → en   (not a lang code)
 */
export function extractLocale(rel: string): string {
  // rel = "hi/trika/siva-sutras/1/1/index.html"
  const first = rel.split('/')[0] ?? '';
  return isLangCode(first) ? first : 'en';
}

/**
 * Classify a URL kind based on path segments AFTER stripping the locale prefix.
 *
 * Segments (after locale) → classification:
 *   0 segments                           → homepage
 *   1 segment, "lemma"                   → lemma   (e.g. /lemma or /hi/lemma)
 *   starts with "lemma/"                 → lemma
 *   2 segments: tradition/text           → text    (e.g. trika/siva-sutras)
 *   4 segments, last 2 numeric           → verse   (e.g. trika/siva-sutras/1/1)
 *   else                                 → other
 */
export function classifyUrl(rel: string): UrlKind {
  // Strip locale prefix if present
  const parts = rel.split('/').filter((p) => p.length > 0 && p !== 'index.html');
  let segments = parts;
  const first = parts[0] ?? '';
  if (isLangCode(first)) {
    segments = parts.slice(1);
  }

  if (segments.length === 0) return 'homepage';
  if (segments[0] === 'lemma' || segments[0]?.startsWith('lemma')) return 'lemma';
  if (segments.length === 2) return 'text';
  if (
    segments.length === 4 &&
    /^\d+(-\d+)?$/.test(segments[2] ?? '') &&
    /^\d+(-\d+)?$/.test(segments[3] ?? '')
  ) {
    return 'verse';
  }
  return 'other';
}

/**
 * Paths that are intentionally noindex and should be skipped by this sweep.
 * These are system/utility pages, not content pages.
 */
export const ALLOWED_NOINDEX_ROUTES = new Set([
  '/404',
  '/sample',
]);

/** Returns true if the HTML string contains a redirect meta-refresh tag. */
export function isRedirectPage(html: string): boolean {
  return /<meta\b[^>]*http-equiv=(?:"refresh"|'refresh'|refresh)[^>]*>/i.test(html);
}

/** Returns true if the HTML string contains a noindex robots meta tag. */
export function hasNoindex(html: string): boolean {
  const metaTagRe = /<meta\b[^>]*>/gi;
  for (const tag of html.match(metaTagRe) ?? []) {
    const nameMatch = tag.match(/\bname=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const name = (nameMatch?.[1] ?? nameMatch?.[2] ?? nameMatch?.[3] ?? '').toLowerCase();
    if (name !== 'robots') continue;
    const contentMatch = tag.match(/\bcontent=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const content = (contentMatch?.[1] ?? contentMatch?.[2] ?? contentMatch?.[3] ?? '').toLowerCase();
    if (content.split(',').map((p) => p.trim()).includes('noindex')) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Core sweep logic (testable, no I/O side-effects)
// ---------------------------------------------------------------------------

export interface SweepResult {
  failures: NoindexFailure[];
  /** locale → count of files checked (only live locales) */
  matrix: Map<string, number>;
}

/**
 * Walk all HTML files under distDir and collect noindex violations for live locales.
 * Pure result — no console output, no process.exit.
 */
export async function sweepDistForNoindex(options: {
  distDir: string;
  liveLocales: Set<string>;
}): Promise<SweepResult> {
  const { distDir, liveLocales } = options;
  const failures: NoindexFailure[] = [];
  const matrix = new Map<string, number>();

  const files = await collectHtmlFiles(distDir);

  await Promise.all(
    files.map(async (filePath) => {
      const rel = relative(distDir, filePath).replaceAll('\\', '/');
      const locale = extractLocale(rel);

      // Only enforce for live locales
      if (!liveLocales.has(locale)) return;

      const routePath = inferRoutePath(distDir, filePath);

      // Skip known utility/system pages that are intentionally noindex
      if (ALLOWED_NOINDEX_ROUTES.has(routePath)) return;

      matrix.set(locale, (matrix.get(locale) ?? 0) + 1);

      const html = await readFile(filePath, 'utf8');

      // Skip redirect stub pages — they must carry noindex by design
      if (isRedirectPage(html)) return;

      if (hasNoindex(html)) {
        failures.push({
          path: filePath,
          locale,
          kind: classifyUrl(rel),
        });
      }
    }),
  );

  return { failures, matrix };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  const liveLocales = liveLocaleSet();
  const { failures, matrix } = await sweepDistForNoindex({
    distDir: DIST_DIR,
    liveLocales: new Set(liveLocales),
  });

  if (failures.length > 0) {
    console.error(`Noindex sweep failed. ${failures.length} live-locale page(s) carry noindex:`);
    console.error(JSON.stringify(failures, null, 2));
    return 1;
  }

  // Pass — print matrix summary
  const liveLocaleList = [...liveLocales].sort();
  const totalChecked = [...matrix.values()].reduce((a, b) => a + b, 0);
  console.log(
    `Noindex sweep: PASS — ${totalChecked} files checked across ${matrix.size} live locale(s).`,
  );
  console.log('');
  console.log('Locale  Files');
  console.log('------  -----');
  for (const lang of liveLocaleList) {
    const count = matrix.get(lang) ?? 0;
    if (count === 0) continue;
    console.log(`${lang.padEnd(6)}  ${count}`);
  }
  return 0;
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
