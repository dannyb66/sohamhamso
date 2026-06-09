#!/usr/bin/env bun
/**
 * seo-phase8-tplus24h — T+24h post-launch measurement.
 *
 * Per `plan-to-do-all-fluffy-hopcroft.md` Phase 8 (lines 354-366):
 *   - OG fallback rate spot-check (50 random URLs across locales) — threshold <2%
 *   - CF Analytics 4xx/5xx rate per locale — threshold <0.5%
 *   - GSC URL inspection on 3 sample URLs per live locale — MANUAL (no API check
 *     unless GSC_ACCESS_TOKEN is set; otherwise prints the inspect URLs as a
 *     human checklist)
 *
 * Exit non-zero if any automated threshold is breached.
 *
 * Usage:
 *   bun scripts/seo-phase8-tplus24h.ts
 *   bun scripts/seo-phase8-tplus24h.ts --origin=https://sohamhamso.org --sample=50
 *
 * Env vars (see .env.example):
 *   CF_ANALYTICS_TOKEN  Cloudflare API token, Account+Zone Analytics:Read scope
 *   CF_ZONE_ID          Cloudflare zone id for sohamhamso.org
 *   GSC_ACCESS_TOKEN    (optional) OAuth access token for GSC API. If unset,
 *                       GSC checks print the inspect URLs as a manual checklist.
 *   GSC_SITE_URL        (optional) GSC property identifier, e.g.
 *                       `sc-domain:sohamhamso.org` or `https://sohamhamso.org/`.
 */

import { type OgProbeResult, probeOg, summarizeOgResults } from './seo-og-live-sample';

// ──────────────────────────────────────────────────────────────────────────
// CLI args
// ──────────────────────────────────────────────────────────────────────────

export interface ParsedArgs {
  origin: string;
  sample: number;
  ogThreshold: number;
  cfThreshold: number;
  skipCf: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  let origin = process.env.SEO_PING_ORIGIN ?? 'https://sohamhamso.org';
  let sample = 50;
  let ogThreshold = 2;
  let cfThreshold = 0.5;
  let skipCf = false;

  for (const arg of argv) {
    if (arg.startsWith('--origin=')) origin = arg.slice('--origin='.length);
    else if (arg.startsWith('--sample=')) {
      const v = Number.parseInt(arg.slice('--sample='.length), 10);
      if (Number.isInteger(v) && v > 0) sample = v;
    } else if (arg.startsWith('--og-threshold=')) {
      const v = Number.parseFloat(arg.slice('--og-threshold='.length));
      if (Number.isFinite(v)) ogThreshold = v;
    } else if (arg.startsWith('--cf-threshold=')) {
      const v = Number.parseFloat(arg.slice('--cf-threshold='.length));
      if (Number.isFinite(v)) cfThreshold = v;
    } else if (arg === '--skip-cf') {
      skipCf = true;
    }
  }

  return { origin: origin.replace(/\/$/, ''), sample, ogThreshold, cfThreshold, skipCf };
}

// ──────────────────────────────────────────────────────────────────────────
// Sitemap-driven random sampler
// ──────────────────────────────────────────────────────────────────────────

/**
 * Parse verse URLs from the live sitemap and derive (lang, OG URL) pairs.
 * Falls back to throwing if the sitemap can't be fetched — we want the cron
 * job to surface that loudly, not run on stale data.
 */
export async function fetchSitemapVerseUrls(origin: string): Promise<string[]> {
  const url = `${origin}/sitemap-verses.xml`;
  const r = await fetch(url, { headers: { 'User-Agent': 'sohamhamso-phase8/1.0' } });
  if (!r.ok) throw new Error(`Sitemap fetch failed: ${r.status} ${url}`);
  const xml = await r.text();
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  if (urls.length === 0) throw new Error(`Sitemap empty: ${url}`);
  return urls;
}

/**
 * Verse page URL → { lang, ogUrl }.
 *
 * Page pattern:   /<lang>/trika/<text>/<ch>/<v>   (lang omitted for English)
 * OG pattern:     /og/<tradition>/<text>/<ch>/<v>[?lang=<lang>]
 */
export function deriveOgUrl(pageUrl: string): { lang: string; ogUrl: string } | null {
  const u = new URL(pageUrl);
  const parts = u.pathname.split('/').filter(Boolean);
  // Expect either [lang, tradition, text, ch, v] (5 parts) or [tradition, text, ch, v] (4 parts).
  const KNOWN_TRADITIONS = new Set(['trika', 'kaula', 'shakta', 'shaiva', 'krama', 'spanda']);
  let lang = 'en';
  let rest = parts;
  if (parts.length === 5 && !KNOWN_TRADITIONS.has(parts[0])) {
    lang = parts[0];
    rest = parts.slice(1);
  } else if (parts.length !== 4) {
    return null;
  }
  if (rest.length !== 4) return null;
  const [tradition, text, ch, v] = rest;
  if (!KNOWN_TRADITIONS.has(tradition)) return null;
  const base = `${u.origin}/og/${tradition}/${text}/${ch}/${v}`;
  const ogUrl = lang === 'en' ? base : `${base}?lang=${encodeURIComponent(lang)}`;
  return { lang, ogUrl };
}

/**
 * Pick `n` URLs uniformly at random from `urls`, stratified across locales so
 * every represented locale gets at least one sample if `n >= locales.size`.
 */
export function stratifiedRandomSample(
  urls: string[],
  n: number,
  rng: () => number = Math.random,
): string[] {
  // Group by locale prefix.
  const byLang = new Map<string, string[]>();
  for (const url of urls) {
    const derived = deriveOgUrl(url);
    if (!derived) continue;
    const arr = byLang.get(derived.lang) ?? [];
    arr.push(url);
    byLang.set(derived.lang, arr);
  }
  const langs = [...byLang.keys()];
  const picked: string[] = [];
  // First pass: 1 per locale.
  for (const lang of langs) {
    const pool = byLang.get(lang);
    if (!pool || pool.length === 0) continue;
    const idx = Math.floor(rng() * pool.length);
    picked.push(pool[idx]);
  }
  // Then fill the rest uniformly from the global pool, avoiding duplicates.
  const all = urls.filter((u) => deriveOgUrl(u) !== null);
  const seen = new Set(picked);
  while (picked.length < n && seen.size < all.length) {
    const idx = Math.floor(rng() * all.length);
    const url = all[idx];
    if (!seen.has(url)) {
      seen.add(url);
      picked.push(url);
    }
  }
  return picked.slice(0, n);
}

// ──────────────────────────────────────────────────────────────────────────
// OG fallback rate check
// ──────────────────────────────────────────────────────────────────────────

export interface OgCheckResult {
  passed: boolean;
  results: OgProbeResult[];
  fallbackRate: number;
  threshold: number;
}

export async function runOgCheck(
  origin: string,
  sample: number,
  threshold: number,
): Promise<OgCheckResult> {
  console.log(`\n[1/3] OG fallback rate — ${sample} random URLs`);
  console.log('-'.repeat(60));

  const urls = await fetchSitemapVerseUrls(origin);
  console.log(`  Sitemap entries: ${urls.length}`);
  const picked = stratifiedRandomSample(urls, sample);
  console.log(`  Sampled:         ${picked.length}`);

  const probes = picked
    .map((u) => deriveOgUrl(u))
    .filter((p): p is NonNullable<typeof p> => p !== null);
  const CONCURRENCY = 10;
  const results: OgProbeResult[] = [];
  for (let i = 0; i < probes.length; i += CONCURRENCY) {
    const batch = probes.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map((p) => probeOg(p.ogUrl, p.lang)));
    results.push(...batchResults);
  }

  const summary = summarizeOgResults(results, threshold);

  console.log('');
  console.log(`  ${'Locale'.padEnd(8)} ${'N'.padEnd(5)} ${'Fallback'.padEnd(10)} Rate`);
  for (const [lang, counts] of summary.byLocale) {
    const rate = (counts.fallback / counts.total) * 100;
    console.log(
      `  ${lang.padEnd(8)} ${String(counts.total).padEnd(5)} ${String(counts.fallback).padEnd(10)} ${rate.toFixed(1)}%`,
    );
  }
  console.log('');
  const flag = summary.passed ? '[ok]' : '[FAIL]';
  console.log(
    `  ${flag} Overall: ${summary.totalFallback}/${summary.total} = ${summary.overallRate.toFixed(2)}% (threshold ${threshold}%)`,
  );

  // Print fallback URLs for debugging if any.
  if (summary.totalFallback > 0) {
    console.log('');
    console.log('  Fallback URLs:');
    for (const r of results.filter((x) => x.fallback)) {
      console.log(`    [${r.status}] ${r.url}  reason=${r.fallbackReason ?? 'unknown'}`);
    }
  }

  return {
    passed: summary.passed,
    results,
    fallbackRate: summary.overallRate,
    threshold,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Cloudflare Analytics check
// ──────────────────────────────────────────────────────────────────────────
//
// CF Analytics is GraphQL: https://api.cloudflare.com/client/v4/graphql.
// Schema: `httpRequestsAdaptiveGroups` is per-request, sliceable by path.
// Token scope required: Account.Analytics:Read + Zone.Analytics:Read.

export interface CfLocaleStat {
  lang: string;
  total: number;
  errors4xx: number;
  errors5xx: number;
  errorRate: number;
}

export interface CfCheckResult {
  passed: boolean;
  perLocale: CfLocaleStat[];
  threshold: number;
  reason?: string;
}

const INDIC_LOCALES = ['hi', 'ta', 'bn', 'te', 'kn', 'ml', 'mr', 'gu', 'pa', 'or', 'as'];

export async function queryCfAnalytics(
  token: string,
  zoneId: string,
  sinceISO: string,
  untilISO: string,
): Promise<{ data: unknown } | { error: string }> {
  // Group by edge response status + URL path. CF returns at most 10k rows
  // per query — for a 4k-verse site over 24h this is well under budget.
  const query = `
    query Phase8Errors($zoneId: String!, $since: Time!, $until: Time!) {
      viewer {
        zones(filter: { zoneTag: $zoneId }) {
          httpRequestsAdaptiveGroups(
            limit: 10000
            filter: { datetime_geq: $since, datetime_leq: $until }
          ) {
            count
            dimensions {
              edgeResponseStatus
              clientRequestPath
            }
          }
        }
      }
    }
  `;
  const r = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      variables: { zoneId, since: sinceISO, until: untilISO },
    }),
  });
  if (!r.ok) return { error: `CF API ${r.status}: ${await r.text()}` };
  const json = (await r.json()) as { data?: unknown; errors?: unknown };
  if (json.errors) return { error: `CF GraphQL errors: ${JSON.stringify(json.errors)}` };
  return { data: json.data };
}

/**
 * Reduce raw CF rows into per-locale 4xx/5xx counts.
 * Locale detection: first URL path segment if it matches a known locale code,
 * else 'en' (or 'static' for non-localized paths like `/og/...`, `/sitemap*`).
 */
export function reduceCfRows(
  rows: Array<{
    count: number;
    dimensions: { edgeResponseStatus: number; clientRequestPath: string };
  }>,
): CfLocaleStat[] {
  const byLang = new Map<string, { total: number; e4: number; e5: number }>();
  for (const row of rows) {
    const path = row.dimensions.clientRequestPath;
    let lang: string;
    const m = path.match(/^\/([a-z]{2,3})(\/|$)/);
    if (m && INDIC_LOCALES.includes(m[1])) {
      lang = m[1];
    } else if (
      path === '/' ||
      path.startsWith('/trika') ||
      path.startsWith('/about') ||
      path.startsWith('/shakta')
    ) {
      lang = 'en';
    } else {
      lang = 'static';
    }
    const e = byLang.get(lang) ?? { total: 0, e4: 0, e5: 0 };
    e.total += row.count;
    const s = row.dimensions.edgeResponseStatus;
    if (s >= 400 && s < 500) e.e4 += row.count;
    else if (s >= 500) e.e5 += row.count;
    byLang.set(lang, e);
  }
  return [...byLang.entries()]
    .map(([lang, e]) => ({
      lang,
      total: e.total,
      errors4xx: e.e4,
      errors5xx: e.e5,
      errorRate: e.total === 0 ? 0 : ((e.e4 + e.e5) / e.total) * 100,
    }))
    .sort((a, b) => a.lang.localeCompare(b.lang));
}

export async function runCfCheck(threshold: number): Promise<CfCheckResult> {
  console.log('\n[2/3] CF Analytics 4xx/5xx rate (last 24h)');
  console.log('-'.repeat(60));

  const token = process.env.CF_ANALYTICS_TOKEN;
  const zoneId = process.env.CF_ZONE_ID;
  if (!token || !zoneId) {
    console.log('  [SKIP] CF_ANALYTICS_TOKEN or CF_ZONE_ID unset.');
    console.log('  Manual check: https://dash.cloudflare.com → Analytics → HTTP traffic');
    console.log('  Filter: last 24h, group by Status code, segment by URL path.');
    return {
      passed: true,
      perLocale: [],
      threshold,
      reason: 'CF_ANALYTICS_TOKEN/CF_ZONE_ID missing (manual check required)',
    };
  }

  const until = new Date();
  const since = new Date(until.getTime() - 24 * 60 * 60 * 1000);
  const res = await queryCfAnalytics(token, zoneId, since.toISOString(), until.toISOString());
  if ('error' in res) {
    console.error(`  [FAIL] ${res.error}`);
    return { passed: false, perLocale: [], threshold, reason: res.error };
  }

  // Narrow the response shape.
  const rows =
    (
      res.data as {
        viewer?: {
          zones?: Array<{
            httpRequestsAdaptiveGroups?: Array<{
              count: number;
              dimensions: { edgeResponseStatus: number; clientRequestPath: string };
            }>;
          }>;
        };
      }
    ).viewer?.zones?.[0]?.httpRequestsAdaptiveGroups ?? [];

  const stats = reduceCfRows(rows);
  console.log(
    `  ${'Locale'.padEnd(8)} ${'Total'.padEnd(8)} ${'4xx'.padEnd(8)} ${'5xx'.padEnd(8)} ErrRate`,
  );
  let anyFail = false;
  for (const s of stats) {
    const flag = s.errorRate > threshold ? '[FAIL]' : '[ok]';
    if (s.errorRate > threshold && s.lang !== 'static') anyFail = true;
    console.log(
      `  ${s.lang.padEnd(8)} ${String(s.total).padEnd(8)} ${String(s.errors4xx).padEnd(8)} ${String(s.errors5xx).padEnd(8)} ${s.errorRate.toFixed(2)}% ${flag}`,
    );
  }
  if (stats.length === 0) {
    console.log('  (no traffic rows returned)');
  }
  console.log('');
  console.log(`  Threshold: ${threshold}% per locale`);
  return { passed: !anyFail, perLocale: stats, threshold };
}

// ──────────────────────────────────────────────────────────────────────────
// GSC URL inspection — automated if GSC_ACCESS_TOKEN present, else manual
// ──────────────────────────────────────────────────────────────────────────

const GSC_SAMPLE_URLS: Record<string, string[]> = {
  en: [
    'https://sohamhamso.org/',
    'https://sohamhamso.org/trika/siva-sutras',
    'https://sohamhamso.org/trika/siva-sutras/1/1',
  ],
  hi: [
    'https://sohamhamso.org/hi',
    'https://sohamhamso.org/hi/trika/siva-sutras',
    'https://sohamhamso.org/hi/trika/siva-sutras/1/1',
  ],
  ta: [
    'https://sohamhamso.org/ta',
    'https://sohamhamso.org/ta/trika/siva-sutras',
    'https://sohamhamso.org/ta/trika/siva-sutras/1/1',
  ],
};

export interface GscInspectResult {
  passed: boolean;
  perUrl: Array<{ url: string; lang: string; verdict: string; ok: boolean }>;
  mode: 'api' | 'manual';
}

export async function runGscInspection(): Promise<GscInspectResult> {
  console.log('\n[3/3] GSC URL inspection (3 URLs per live locale)');
  console.log('-'.repeat(60));

  const token = process.env.GSC_ACCESS_TOKEN;
  const site = process.env.GSC_SITE_URL ?? 'sc-domain:sohamhamso.org';

  if (!token) {
    console.log('  [MANUAL] GSC_ACCESS_TOKEN unset. OAuth setup required for API mode.');
    console.log('  See scripts/seo/PHASE8-README.md for OAuth setup steps.');
    console.log('  ');
    console.log('  Inspect these URLs manually in GSC:');
    console.log(
      `    https://search.google.com/search-console/inspect?resource_id=${encodeURIComponent(site)}`,
    );
    console.log('  ');
    const perUrl: Array<{ url: string; lang: string; verdict: string; ok: boolean }> = [];
    for (const [lang, urls] of Object.entries(GSC_SAMPLE_URLS)) {
      console.log(`  ${lang}:`);
      for (const url of urls) {
        console.log(`    ${url}`);
        perUrl.push({ url, lang, verdict: 'MANUAL', ok: true });
      }
    }
    console.log('  ');
    console.log('  Pass criteria: "URL is on Google" or "Discovered — currently not indexed".');
    console.log('  Fail criteria: any "Page with redirect", "Excluded by noindex", or "Error".');
    return { passed: true, perUrl, mode: 'manual' };
  }

  // GSC API mode.
  const perUrl: Array<{ url: string; lang: string; verdict: string; ok: boolean }> = [];
  let anyFail = false;
  for (const [lang, urls] of Object.entries(GSC_SAMPLE_URLS)) {
    for (const url of urls) {
      const r = await fetch('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ inspectionUrl: url, siteUrl: site }),
      });
      if (!r.ok) {
        const errTxt = await r.text();
        console.error(`  [FAIL] ${url} — GSC API ${r.status}: ${errTxt.slice(0, 200)}`);
        perUrl.push({ url, lang, verdict: `API_ERROR_${r.status}`, ok: false });
        anyFail = true;
        continue;
      }
      const json = (await r.json()) as {
        inspectionResult?: { indexStatusResult?: { coverageState?: string; verdict?: string } };
      };
      const cov = json.inspectionResult?.indexStatusResult?.coverageState ?? 'UNKNOWN';
      const verdict = json.inspectionResult?.indexStatusResult?.verdict ?? 'UNKNOWN';
      // T+24h tolerable states: indexed OR discovered-not-yet-indexed.
      // Failures: noindex, redirect, error, excluded.
      const ok =
        verdict === 'PASS' ||
        cov === 'Submitted and indexed' ||
        cov === 'Discovered - currently not indexed' ||
        cov === 'Crawled - currently not indexed';
      if (!ok) anyFail = true;
      console.log(`  ${ok ? '[ok]' : '[FAIL]'} [${lang}] ${url}`);
      console.log(`      verdict=${verdict}  coverage=${cov}`);
      perUrl.push({ url, lang, verdict: `${verdict}/${cov}`, ok });
    }
  }
  return { passed: !anyFail, perUrl, mode: 'api' };
}

// ──────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────

export async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  console.log('SEO Phase 8 — T+24h measurement');
  console.log(`  Origin:        ${args.origin}`);
  console.log(`  Sample:        ${args.sample} URLs`);
  console.log(`  OG threshold:  ${args.ogThreshold}%`);
  console.log(`  CF threshold:  ${args.cfThreshold}%`);

  const og = await runOgCheck(args.origin, args.sample, args.ogThreshold);
  const cf = args.skipCf
    ? { passed: true, perLocale: [], threshold: args.cfThreshold, reason: 'skipped via --skip-cf' }
    : await runCfCheck(args.cfThreshold);
  const gsc = await runGscInspection();

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('Summary');
  console.log('══════════════════════════════════════════════════════════');
  console.log(
    `  OG fallback rate:    ${og.passed ? 'PASS' : 'FAIL'} (${og.fallbackRate.toFixed(2)}% vs ${og.threshold}%)`,
  );
  console.log(
    `  CF 4xx/5xx rate:     ${cf.passed ? 'PASS' : 'FAIL'}${cf.reason ? ` (${cf.reason})` : ''}`,
  );
  console.log(`  GSC URL inspection:  ${gsc.passed ? 'PASS' : 'FAIL'} (${gsc.mode} mode)`);

  const allPassed = og.passed && cf.passed && gsc.passed;
  return allPassed ? 0 : 1;
}

if (import.meta.main) {
  const code = await main();
  process.exit(code);
}
