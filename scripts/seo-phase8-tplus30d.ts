#!/usr/bin/env bun
/**
 * seo-phase8-tplus30d — T+30d post-launch measurement.
 *
 * Per `plan-to-do-all-fluffy-hopcroft.md` Phase 8 (lines 354-366):
 *   - Lighthouse / CrUX baseline — LCP < 2.5s on:
 *       `/`, `/trika/siva-sutras`, `/hi/trika/siva-sutras/1/1`
 *   - GSC Coverage — zero "Submitted URL marked noindex" per locale
 *
 * LCP measurement strategy (advisor flagged this):
 *   1. PRIMARY: lab Lighthouse via `npx lighthouse --output=json` (headless
 *      Chrome). Works even with zero real-user traffic.
 *   2. BONUS: CrUX API (field data). Fresh low-traffic sites typically return
 *      `404 NOT_FOUND` for ~6 months — that's expected, not a failure.
 *
 * Usage:
 *   bun scripts/seo-phase8-tplus30d.ts
 *   bun scripts/seo-phase8-tplus30d.ts --skip-lighthouse  (CrUX-only)
 *
 * Env vars (see .env.example):
 *   GSC_ACCESS_TOKEN  OAuth access token for GSC API
 *   GSC_SITE_URL      GSC property identifier
 *   CRUX_API_KEY      (optional) CrUX API key — only needed if you hit rate
 *                     limits on the free tier
 */

import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LCP_THRESHOLD_MS = 2500;
const TARGET_URLS = [
  'https://sohamhamso.org/',
  'https://sohamhamso.org/trika/siva-sutras',
  'https://sohamhamso.org/hi/trika/siva-sutras/1/1',
];

// ──────────────────────────────────────────────────────────────────────────
// CLI args
// ──────────────────────────────────────────────────────────────────────────

export interface ParsedArgs {
  skipLighthouse: boolean;
  skipCrux: boolean;
  skipGsc: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  return {
    skipLighthouse: argv.includes('--skip-lighthouse'),
    skipCrux: argv.includes('--skip-crux'),
    skipGsc: argv.includes('--skip-gsc'),
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Lighthouse (lab data) — primary
// ──────────────────────────────────────────────────────────────────────────

export interface LhResult {
  url: string;
  lcpMs: number | null;
  performance: number | null;
  error?: string;
}

export function runLighthouse(url: string): LhResult {
  const outPath = join(tmpdir(), `phase8-lh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
  try {
    // --quiet shrinks stdout. We read the JSON file directly afterwards.
    execSync(
      `npx -y lighthouse "${url}" ` +
        `--quiet --no-enable-error-reporting ` +
        `--output=json --output-path="${outPath}" ` +
        `--chrome-flags="--headless=new --no-sandbox" ` +
        `--only-categories=performance ` +
        `--throttling-method=simulate`,
      { stdio: ['ignore', 'pipe', 'pipe'], timeout: 180_000 },
    );
    const raw = readFileSync(outPath, 'utf8');
    const json = JSON.parse(raw) as {
      audits?: { 'largest-contentful-paint'?: { numericValue?: number } };
      categories?: { performance?: { score?: number } };
    };
    const lcpMs = json.audits?.['largest-contentful-paint']?.numericValue ?? null;
    const performance = json.categories?.performance?.score ?? null;
    return { url, lcpMs, performance };
  } catch (e) {
    return { url, lcpMs: null, performance: null, error: (e as Error).message.slice(0, 200) };
  }
}

// ──────────────────────────────────────────────────────────────────────────
// CrUX API (field data) — best-effort
// ──────────────────────────────────────────────────────────────────────────

export interface CruxResult {
  url: string;
  p75LcpMs: number | null;
  formFactor: string;
  status: 'ok' | 'no-data' | 'error';
  reason?: string;
}

export async function fetchCrux(url: string, apiKey: string | undefined): Promise<CruxResult> {
  const endpoint = apiKey
    ? `https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=${apiKey}`
    : 'https://chromeuxreport.googleapis.com/v1/records:queryRecord';
  const r = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
      formFactor: 'PHONE',
      metrics: ['largest_contentful_paint'],
    }),
  });
  if (r.status === 404) {
    return { url, p75LcpMs: null, formFactor: 'PHONE', status: 'no-data', reason: 'NOT_FOUND' };
  }
  if (!r.ok) {
    return {
      url,
      p75LcpMs: null,
      formFactor: 'PHONE',
      status: 'error',
      reason: `${r.status}: ${(await r.text()).slice(0, 200)}`,
    };
  }
  const json = (await r.json()) as {
    record?: {
      metrics?: {
        largest_contentful_paint?: { percentiles?: { p75?: number } };
      };
    };
  };
  const p75 = json.record?.metrics?.largest_contentful_paint?.percentiles?.p75 ?? null;
  return { url, p75LcpMs: p75, formFactor: 'PHONE', status: 'ok' };
}

// ──────────────────────────────────────────────────────────────────────────
// GSC noindex errors
// ──────────────────────────────────────────────────────────────────────────

export interface GscNoindexResult {
  noindexErrors: Array<{ category: string; count: number }>;
  totalErrors: number;
  passed: boolean;
  mode: 'api' | 'manual';
  error?: string;
}

export async function fetchGscNoindex(token: string, site: string): Promise<GscNoindexResult> {
  // The classic GSC `urlCrawlErrorsCounts` API was deprecated in 2017.
  // For per-category counts we use the sitemaps endpoint to read submitted
  // counts and then drill into Inspection API for a sample. The cron job
  // can also just rely on the dashboard for the full per-category list.
  //
  // What's exposed via API today:
  //   - sitemap submission warnings/errors via sitemaps.list (has `warnings`,
  //     `errors`)
  //   - per-URL `coverageState` via urlInspection
  //
  // We treat any sitemap-reported `errors` count as the noindex proxy. If the
  // sitemap shows zero errors, we mark pass; for fine-grained per-category
  // breakdown (Submitted URL marked noindex, Soft 404, etc.) point to the
  // Coverage report.
  const url = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/sitemaps`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) {
    return {
      noindexErrors: [],
      totalErrors: 0,
      passed: false,
      mode: 'api',
      error: `${r.status}: ${(await r.text()).slice(0, 200)}`,
    };
  }
  const json = (await r.json()) as {
    sitemap?: Array<{ path: string; errors?: string; warnings?: string }>;
  };
  let totalErrors = 0;
  const list: Array<{ category: string; count: number }> = [];
  for (const sm of json.sitemap ?? []) {
    const e = Number(sm.errors ?? 0);
    if (e > 0) list.push({ category: `sitemap:${sm.path}`, count: e });
    totalErrors += e;
  }
  return { noindexErrors: list, totalErrors, passed: totalErrors === 0, mode: 'api' };
}

function printGscManualChecklist(site: string): void {
  console.log('  [MANUAL] GSC_ACCESS_TOKEN unset. OAuth setup required for API mode.');
  console.log('  See scripts/seo/PHASE8-README.md for OAuth setup steps.');
  console.log('  ');
  console.log('  Inspect GSC Coverage for "Submitted URL marked noindex":');
  console.log(
    `    https://search.google.com/search-console/index?resource_id=${encodeURIComponent(site)}`,
  );
  console.log('  Filter by issue type "Submitted URL marked noindex".');
  console.log('  Pass criteria: zero errors per locale.');
}

// ──────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────

export async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  console.log('SEO Phase 8 — T+30d measurement');
  console.log('-'.repeat(60));

  let anyFail = false;

  // ── Lighthouse ───────────────────────────────────────────────────────
  console.log('');
  console.log('[1/3] Lighthouse LCP (lab data)');
  console.log('-'.repeat(60));
  if (args.skipLighthouse) {
    console.log('  [SKIP] --skip-lighthouse');
  } else {
    console.log(`  ${'URL'.padEnd(56)} ${'LCP'.padEnd(10)} Perf`);
    for (const url of TARGET_URLS) {
      const res = runLighthouse(url);
      if (res.error) {
        console.error(`  [FAIL] ${url}  error=${res.error}`);
        anyFail = true;
        continue;
      }
      const flag = res.lcpMs !== null && res.lcpMs < LCP_THRESHOLD_MS ? '[ok]' : '[FAIL]';
      if (res.lcpMs === null || res.lcpMs >= LCP_THRESHOLD_MS) anyFail = true;
      const lcpStr = res.lcpMs === null ? 'n/a' : `${Math.round(res.lcpMs)}ms`;
      const perfStr = res.performance === null ? 'n/a' : (res.performance * 100).toFixed(0);
      console.log(
        `  ${url.slice(0, 56).padEnd(56)} ${lcpStr.padEnd(10)} ${perfStr} ${flag}`,
      );
    }
    console.log(`  Threshold: LCP < ${LCP_THRESHOLD_MS}ms`);
  }

  // ── CrUX ─────────────────────────────────────────────────────────────
  console.log('');
  console.log('[2/3] CrUX field data (best-effort — typically no data <6mo old)');
  console.log('-'.repeat(60));
  if (args.skipCrux) {
    console.log('  [SKIP] --skip-crux');
  } else {
    const cruxKey = process.env.CRUX_API_KEY;
    if (!cruxKey) {
      console.log('  Note: CRUX_API_KEY unset. Anonymous CrUX requests return 403.');
      console.log('  Set CRUX_API_KEY in repo secrets to enable (best-effort only).');
    }
    console.log(`  ${'URL'.padEnd(56)} ${'p75 LCP'.padEnd(12)} Status`);
    for (const url of TARGET_URLS) {
      const res = await fetchCrux(url, cruxKey);
      const lcpStr = res.p75LcpMs === null ? 'n/a' : `${Math.round(res.p75LcpMs)}ms`;
      const note = res.status === 'no-data' ? '(no data — expected)' : res.reason ?? res.status;
      console.log(`  ${url.slice(0, 56).padEnd(56)} ${lcpStr.padEnd(12)} ${note}`);
      // CrUX is best-effort: do NOT fail the run on missing field data.
    }
  }

  // ── GSC noindex errors ──────────────────────────────────────────────
  console.log('');
  console.log('[3/3] GSC noindex errors per locale');
  console.log('-'.repeat(60));
  const token = process.env.GSC_ACCESS_TOKEN;
  const site = process.env.GSC_SITE_URL ?? 'sc-domain:sohamhamso.org';
  if (args.skipGsc || !token) {
    printGscManualChecklist(site);
    if (process.env.GITHUB_ACTIONS === 'true') {
      console.log('::warning title=GSC Phase 8 T+30d::Manual checklist required (GSC_ACCESS_TOKEN unset)');
    }
  } else {
    const r = await fetchGscNoindex(token, site);
    if (r.error) {
      console.error(`  [FAIL] GSC API: ${r.error}`);
      anyFail = true;
    } else if (r.totalErrors === 0) {
      console.log('  [ok] Zero sitemap-reported errors.');
    } else {
      console.log(`  [FAIL] ${r.totalErrors} errors across ${r.noindexErrors.length} sitemap(s):`);
      for (const e of r.noindexErrors) {
        console.log(`    ${e.category}: ${e.count}`);
      }
      anyFail = true;
    }
    console.log('');
    console.log('  Note: for per-category breakdown ("Submitted URL marked noindex" specifically)');
    console.log('  inspect Coverage report manually — that detail is not exposed via API.');
  }

  console.log('');
  console.log('══════════════════════════════════════════════════════════');
  console.log('Summary');
  console.log('══════════════════════════════════════════════════════════');
  console.log(`  Lighthouse LCP < ${LCP_THRESHOLD_MS}ms:   ${args.skipLighthouse ? 'SKIPPED' : anyFail ? 'see above' : 'PASS'}`);
  console.log(`  CrUX field data:          best-effort (does not affect exit code)`);
  console.log(`  GSC zero errors:          ${args.skipGsc || !token ? 'MANUAL' : anyFail ? 'see above' : 'PASS'}`);
  return anyFail ? 1 : 0;
}

if (import.meta.main) {
  const code = await main();
  process.exit(code);
}
