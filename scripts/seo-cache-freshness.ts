#!/usr/bin/env bun
/**
 * seo-cache-freshness — verify that key URLs are NOT cached (cf-cache-status != HIT)
 * after a deploy/purge.
 *
 * MISS or DYNAMIC = fresh (expected). HIT = stale (failure).
 * If cf-cache-status header is absent (non-CF proxied request, e.g. local testing)
 * the check is skipped with a warning.
 *
 * Exits 1 if any key URL returns cf-cache-status: HIT.
 */

import { liveLocaleSet } from '../src/lib/seo/i18n-routes';

export interface ParsedArgs {
  origin: string | null;
}

export function parseArgs(argv: string[]): ParsedArgs {
  let origin = process.env.SEO_PING_ORIGIN ?? null;

  for (const arg of argv) {
    if (arg.startsWith('--origin=')) {
      origin = arg.slice('--origin='.length) || null;
    }
  }

  return { origin };
}

export interface FreshnessTarget {
  key: boolean; // must-pass target
  name: string;
  path: string;
}

export function buildTargets(): FreshnessTarget[] {
  // Determine locale pages to probe: first 3 locales from liveLocaleSet()
  const locales = Array.from(liveLocaleSet()).slice(0, 3);

  const localePaths: FreshnessTarget[] = locales.map((lang) => ({
    name: `page-${lang}`,
    path: lang === 'en' ? '/' : `/${lang}`,
    key: true,
  }));

  return [
    { name: 'robots.txt', path: '/robots.txt', key: true },
    { name: 'sitemap-index.xml', path: '/sitemap-index.xml', key: true },
    { name: 'sitemap-verses.xml', path: '/sitemap-verses.xml', key: true },
    { name: 'sitemap-texts.xml', path: '/sitemap-texts.xml', key: true },
    { name: 'sitemap-lemmas.xml', path: '/sitemap-lemmas.xml', key: true },
    { name: 'sitemap-chrome.xml', path: '/sitemap-chrome.xml', key: true },
    ...localePaths,
  ];
}

export type CfCacheStatus = 'HIT' | 'MISS' | 'DYNAMIC' | 'BYPASS' | 'EXPIRED' | 'STALE' | string;

export interface FreshnessResult {
  cfCacheStatus: CfCacheStatus | null;
  fresh: boolean | null; // null = skipped (no cf header)
  name: string;
  skip: boolean;
  status: number;
  url: string;
}

export async function checkFreshness(
  origin: string,
  target: FreshnessTarget,
): Promise<FreshnessResult> {
  const url = new URL(target.path, origin).toString();
  const response = await fetch(url, {
    redirect: 'manual',
    headers: { 'User-Agent': 'sohamhamso-seo-cache-freshness/1.0' },
  });

  const cfCacheStatus = response.headers.get('cf-cache-status') as CfCacheStatus | null;
  const skip = cfCacheStatus === null;
  const fresh = skip ? null : cfCacheStatus !== 'HIT';

  return {
    name: target.name,
    url,
    status: response.status,
    cfCacheStatus,
    skip,
    fresh,
  };
}

export interface FreshnessSummary {
  allFresh: boolean;
  cfHeaderAbsent: boolean;
  failures: FreshnessResult[];
}

export function evaluateFreshness(results: FreshnessResult[]): FreshnessSummary {
  const failures = results.filter((r) => r.fresh === false);
  const cfHeaderAbsent = results.some((r) => r.skip);
  return { failures, cfHeaderAbsent, allFresh: failures.length === 0 };
}

function padEnd(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.origin) {
    throw new Error('Pass --origin=https://example.com or set SEO_PING_ORIGIN.');
  }

  const origin = new URL(args.origin).toString().replace(/\/$/, '');
  const targets = buildTargets();

  console.log(`SEO cache freshness check`);
  console.log(`- Origin: ${origin}`);
  console.log(`- URLs:   ${targets.length}`);
  console.log('');

  const results = await Promise.all(targets.map((t) => checkFreshness(origin, t)));

  // Print table
  console.log(`${'Name'.padEnd(24)} ${'Status'.padEnd(8)} ${'CF-Cache-Status'.padEnd(18)} Result`);
  console.log('-'.repeat(68));

  for (const result of results) {
    let resultStr: string;
    if (result.skip) {
      resultStr = '[skip — no CF header]';
    } else if (result.fresh) {
      resultStr = '[fresh]';
    } else {
      resultStr = '[STALE — HIT]';
    }

    console.log(
      `${padEnd(result.name, 24)} ${String(result.status).padEnd(8)} ${padEnd(result.cfCacheStatus ?? '—', 18)} ${resultStr}`,
    );
  }

  const summary = evaluateFreshness(results);

  if (summary.cfHeaderAbsent) {
    console.log('');
    console.log(
      'Warning: cf-cache-status absent on some responses — request is not CF-proxied (local/staging only?).',
    );
  }

  if (!summary.allFresh) {
    const names = summary.failures.map((r) => r.name).join(', ');
    console.error(`\nSEO cache freshness FAILED: stale (HIT) for: ${names}`);
    process.exit(1);
  }

  console.log('\nAll checked URLs are fresh (not HIT).');
}

if (!process.env.VITEST) {
  await main();
}
