#!/usr/bin/env bun
/**
 * seo-live-noindex-sweep — verify that live-locale pages do NOT carry noindex meta tags.
 *
 * For each locale in liveLocaleSet(): samples 2 verse URLs and 1 text URL.
 * Parses response HTML for <meta name="robots" ... content="...noindex..."> patterns.
 *
 * LIVE locale must NOT have noindex. Any violation → exit 1.
 *
 * Also captures cf-cache-status for debugging (does not fail on cache status).
 */

import { liveLocaleSet } from '../src/lib/seo/i18n-routes';
import { localePathFor } from '../src/lib/seo/i18n-routes';

interface ParsedArgs {
  origin: string | null;
}

function parseArgs(argv: string[]): ParsedArgs {
  let origin = process.env.SEO_PING_ORIGIN ?? null;

  for (const arg of argv) {
    if (arg.startsWith('--origin=')) {
      origin = arg.slice('--origin='.length) || null;
    }
  }

  return { origin };
}

// Static verse + text samples — no corpus DB dependency
const VERSE_SAMPLES: Array<{ chapter: number; verse: number; basePath: string }> = [
  { chapter: 1, verse: 1, basePath: '/trika/siva-sutras/1/1' },
  { chapter: 1, verse: 5, basePath: '/trika/siva-sutras/1/5' },
];

const TEXT_SAMPLES: Array<{ basePath: string }> = [{ basePath: '/trika/siva-sutras' }];

const NOINDEX_RE =
  /<meta\s[^>]*name\s*=\s*["']robots["'][^>]*content\s*=\s*["'][^"']*noindex[^"']*["']/i;
// Also match reversed attribute order: content=... name=robots
const NOINDEX_RE2 =
  /<meta\s[^>]*content\s*=\s*["'][^"']*noindex[^"']*["'][^>]*name\s*=\s*["']robots["']/i;

function hasNoindex(html: string): boolean {
  return NOINDEX_RE.test(html) || NOINDEX_RE2.test(html);
}

type UrlType = 'verse' | 'text';

interface SweepResult {
  cfCacheStatus: string | null;
  lang: string;
  noindex: boolean;
  path: string;
  status: number;
  type: UrlType;
  url: string;
  violation: boolean; // noindex on a live locale
}

async function sweepUrl(
  origin: string,
  lang: string,
  basePath: string,
  type: UrlType,
): Promise<SweepResult> {
  const localePath = localePathFor(basePath, lang);
  const url = new URL(localePath, origin).toString();

  const response = await fetch(url, {
    redirect: 'manual',
    headers: { 'User-Agent': 'sohamhamso-seo-noindex-sweep/1.0' },
  });

  const cfCacheStatus = response.headers.get('cf-cache-status');

  // Only parse HTML bodies — non-200 or non-HTML responses can't carry noindex
  let noindex = false;
  const contentType = response.headers.get('content-type') ?? '';
  if (response.ok && contentType.includes('html')) {
    // Read only the <head> portion to keep memory usage low (first 8 KB)
    const reader = response.body?.getReader();
    let html = '';
    if (reader) {
      let done = false;
      while (!done && html.length < 8192) {
        const chunk = await reader.read();
        done = chunk.done;
        if (chunk.value) html += new TextDecoder().decode(chunk.value);
      }
      reader.cancel();
    }
    noindex = hasNoindex(html);
  } else {
    // Drain the response body to avoid socket leaks
    await response.body?.cancel();
  }

  return {
    lang,
    path: localePath,
    url,
    type,
    status: response.status,
    cfCacheStatus,
    noindex,
    violation: noindex, // live locales must NOT have noindex
  };
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
  const locales = Array.from(liveLocaleSet());

  console.log(`SEO live noindex sweep`);
  console.log(`- Origin:  ${origin}`);
  console.log(`- Locales: ${locales.join(', ')}`);
  console.log(
    `- Samples: ${VERSE_SAMPLES.length} verse(s) + ${TEXT_SAMPLES.length} text(s) per locale = ${locales.length * (VERSE_SAMPLES.length + TEXT_SAMPLES.length)} URLs`,
  );
  console.log('');

  // Build probe list
  type Probe = { basePath: string; lang: string; type: UrlType };
  const probes: Probe[] = [];
  for (const lang of locales) {
    for (const v of VERSE_SAMPLES) probes.push({ lang, basePath: v.basePath, type: 'verse' });
    for (const t of TEXT_SAMPLES) probes.push({ lang, basePath: t.basePath, type: 'text' });
  }

  // Fetch concurrently
  const CONCURRENCY = 16;
  const results: SweepResult[] = [];
  for (let i = 0; i < probes.length; i += CONCURRENCY) {
    const batch = probes.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((p) => sweepUrl(origin, p.lang, p.basePath, p.type)),
    );
    results.push(...batchResults);
  }

  // Print matrix
  console.log(
    `${'Locale'.padEnd(8)} ${'Type'.padEnd(7)} ${'HTTP'.padEnd(5)} ${'CF-Cache'.padEnd(12)} ${'Noindex'.padEnd(9)} Result`,
  );
  console.log('-'.repeat(62));

  for (const r of results) {
    const resultStr = r.violation ? '[FAIL — noindex found]' : '[ok]';
    console.log(
      `${padEnd(r.lang, 8)} ${padEnd(r.type, 7)} ${String(r.status).padEnd(5)} ${padEnd(r.cfCacheStatus ?? '—', 12)} ${padEnd(r.noindex ? 'YES' : 'no', 9)} ${resultStr}`,
    );
  }

  const violations = results.filter((r) => r.violation);
  if (violations.length > 0) {
    console.log('');
    console.log('Violations:');
    for (const v of violations) {
      console.error(`  [${v.lang}] ${v.url}`);
    }
    console.error(`\nSEO noindex sweep FAILED: ${violations.length} violation(s) found.`);
    process.exit(1);
  }

  console.log('\nAll live-locale URLs are noindex-free.');
}

await main();
