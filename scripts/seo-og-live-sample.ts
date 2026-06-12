#!/usr/bin/env bun
/**
 * seo-og-live-sample — probe OG image endpoints for resvg-wasm vs fallback rate.
 *
 * OG URL format: /og/trika/siva-sutras/{chapter}/{verse}?lang={lang}
 * (en omits the ?lang param since it is OG_DEFAULT_LANG)
 *
 * Success:   status 200 AND X-OG-Renderer: resvg-wasm AND no X-OG-Fallback header
 * Fallback:  X-OG-Fallback present (regardless of status)
 *
 * Exits 1 if fallback rate > --threshold (default 2%).
 */

import { liveLocaleSet } from '../src/lib/seo/i18n-routes';

// First 10 verses from siva-sutras, sampled across chapters 1-3.
// Chapter 1 has 22 verses, chapters 2/3 have fewer — we hard-code a static
// list that is guaranteed to exist so the script has no corpus DB dependency.
const SAMPLE_VERSES: Array<{ chapter: number; verse: number }> = [
  { chapter: 1, verse: 1 },
  { chapter: 1, verse: 2 },
  { chapter: 1, verse: 3 },
  { chapter: 1, verse: 4 },
  { chapter: 1, verse: 5 },
  { chapter: 1, verse: 6 },
  { chapter: 1, verse: 7 },
  { chapter: 1, verse: 8 },
  { chapter: 1, verse: 9 },
  { chapter: 1, verse: 10 },
];

export interface ParsedArgs {
  origin: string | null;
  sample: number;
  threshold: number;
}

export function parseArgs(argv: string[]): ParsedArgs {
  let origin = process.env.SEO_PING_ORIGIN ?? null;
  let threshold = 2;
  let sample = 10;

  for (const arg of argv) {
    if (arg.startsWith('--origin=')) {
      origin = arg.slice('--origin='.length) || null;
    } else if (arg.startsWith('--threshold=')) {
      const v = Number.parseFloat(arg.slice('--threshold='.length));
      if (Number.isFinite(v)) threshold = v;
    } else if (arg.startsWith('--sample=')) {
      const v = Number.parseInt(arg.slice('--sample='.length), 10);
      if (Number.isInteger(v) && v > 0) sample = v;
    }
  }

  return { origin, threshold, sample };
}

export interface OgProbeResult {
  fallback: boolean;
  fallbackReason: string | null;
  lang: string;
  renderer: string | null;
  status: number;
  url: string;
}

export async function probeOg(url: string, lang: string): Promise<OgProbeResult> {
  const response = await fetch(url, {
    redirect: 'manual',
    headers: { 'User-Agent': 'sohamhamso-seo-og-sample/1.0' },
  });

  const renderer = response.headers.get('X-OG-Renderer');
  const fallbackHeader = response.headers.get('X-OG-Fallback');
  const fallback = fallbackHeader !== null;
  const fallbackReason = response.headers.get('X-OG-Fallback-Reason');

  return {
    lang,
    url,
    status: response.status,
    renderer,
    fallback,
    fallbackReason,
  };
}

export function buildOgUrl(origin: string, chapter: number, verse: number, lang: string): string {
  const base = `${origin}/og/trika/siva-sutras/${chapter}/${verse}`;
  // English is the default OG lang; no ?lang param needed
  return lang === 'en' ? base : `${base}?lang=${lang}`;
}

export interface OgSummary {
  byLocale: Map<string, { fallback: number; total: number }>;
  overallRate: number;
  passed: boolean;
  total: number;
  totalFallback: number;
}

export function summarizeOgResults(results: OgProbeResult[], threshold: number): OgSummary {
  const byLocale = new Map<string, { fallback: number; total: number }>();
  for (const result of results) {
    const entry = byLocale.get(result.lang) ?? { total: 0, fallback: 0 };
    entry.total++;
    if (result.fallback) entry.fallback++;
    byLocale.set(result.lang, entry);
  }
  const totalFallback = results.filter((r) => r.fallback).length;
  const total = results.length;
  const overallRate = total === 0 ? 0 : (totalFallback / total) * 100;
  return { totalFallback, total, overallRate, passed: overallRate <= threshold, byLocale };
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
  const verses = SAMPLE_VERSES.slice(0, args.sample);

  console.log(`OG live sample`);
  console.log(`- Origin:    ${origin}`);
  console.log(`- Locales:   ${locales.join(', ')}`);
  console.log(`- Verses:    ${verses.length} per locale`);
  console.log(`- Total:     ${locales.length * verses.length} URLs`);
  console.log(`- Threshold: ${args.threshold}% fallback rate`);
  console.log('');

  // Build full URL list
  const probes: Array<{ chapter: number; lang: string; url: string; verse: number }> = [];
  for (const lang of locales) {
    for (const { chapter, verse } of verses) {
      probes.push({ lang, chapter, verse, url: buildOgUrl(origin, chapter, verse, lang) });
    }
  }

  // Fetch concurrently (batch to avoid hitting CF rate limits)
  const CONCURRENCY = 20;
  const results: OgProbeResult[] = [];
  for (let i = 0; i < probes.length; i += CONCURRENCY) {
    const batch = probes.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map((p) => probeOg(p.url, p.lang)));
    results.push(...batchResults);
  }

  const summary = summarizeOgResults(results, args.threshold);

  // Print table header
  console.log(
    `${'Locale'.padEnd(8)} ${'Total'.padEnd(7)} ${'Fallback'.padEnd(10)} ${'Rate'.padEnd(8)} Status`,
  );
  console.log('-'.repeat(52));

  for (const [lang, counts] of summary.byLocale) {
    const rate = (counts.fallback / counts.total) * 100;
    const flag = rate > args.threshold ? '[FAIL]' : '[ok]';
    console.log(
      `${padEnd(lang, 8)} ${String(counts.total).padEnd(7)} ${String(counts.fallback).padEnd(10)} ${rate.toFixed(1).padEnd(7)}% ${flag}`,
    );
  }

  console.log('');
  console.log(
    `Overall: ${summary.totalFallback}/${summary.total} fallback (${summary.overallRate.toFixed(2)}%)`,
  );

  // Print individual failures for debugging
  const failures = results.filter((r) => r.fallback);
  if (failures.length > 0) {
    console.log('');
    console.log('Fallback URLs:');
    for (const f of failures) {
      console.log(`  [${f.status}] ${f.url}  reason=${f.fallbackReason ?? 'unknown'}`);
    }
  }

  if (!summary.passed) {
    console.error(
      `\nOG live sample FAILED: fallback rate ${summary.overallRate.toFixed(2)}% exceeds threshold ${args.threshold}%`,
    );
    process.exit(1);
  }
}

// Match the repo convention used in seo-validate / seo-hreflang-closure / etc.
// Older guard was `!process.env.VITEST`, but that also triggered when this
// file was imported by another script (e.g. seo-phase8-tplus24h.ts).
if (import.meta.main) {
  await main();
}
