#!/usr/bin/env bun
/**
 * seo-phase8-tplus7d — T+7d post-launch measurement.
 *
 * Per `plan-to-do-all-fluffy-hopcroft.md` Phase 8 (lines 354-366):
 *   - GSC Coverage report — ≥60% of submitted URLs in "Submitted and indexed"
 *   - GSC Performance — Indic-language query impressions > 0
 *
 * Both checks require GSC API access. When `GSC_ACCESS_TOKEN` is unset we
 * print a manual checklist with the exact GSC dashboard URLs to inspect
 * (and exit 0 so the cron run doesn't churn on missing credentials — the
 * workflow surfaces a `::warning::` annotation instead).
 *
 * Usage:
 *   bun scripts/seo-phase8-tplus7d.ts
 *
 * Env vars (see .env.example):
 *   GSC_ACCESS_TOKEN  OAuth access token for GSC API
 *   GSC_SITE_URL      GSC property identifier (sc-domain:sohamhamso.org or URL prefix)
 */

const INDIC_LOCALES = ['hi', 'ta', 'bn', 'te', 'kn', 'ml', 'mr', 'gu', 'pa', 'or', 'as'];
const COVERAGE_THRESHOLD = 60; // percent

const SITEMAPS = [
  'https://sohamhamso.org/sitemap-verses.xml',
  'https://sohamhamso.org/sitemap-texts.xml',
  'https://sohamhamso.org/sitemap-lemmas.xml',
  'https://sohamhamso.org/sitemap-chrome.xml',
];

// ──────────────────────────────────────────────────────────────────────────
// Manual fallback
// ──────────────────────────────────────────────────────────────────────────

function printManualChecklist(site: string): void {
  console.log('  [MANUAL] GSC_ACCESS_TOKEN unset. OAuth setup required for API mode.');
  console.log('  See scripts/seo/PHASE8-README.md for OAuth setup steps.');
  console.log('  ');
  console.log('  Manual checklist (T+7d):');
  console.log('  ');
  console.log('  1. GSC Coverage — Submitted and indexed share');
  console.log(
    `     https://search.google.com/search-console/index?resource_id=${encodeURIComponent(site)}`,
  );
  console.log('     Threshold: ≥60% of submitted URLs in "Submitted and indexed".');
  console.log('     Per-sitemap breakdown:');
  for (const sm of SITEMAPS) {
    console.log(`       ${sm}`);
  }
  console.log('  ');
  console.log('  2. GSC Performance — Indic-language query impressions');
  console.log(
    `     https://search.google.com/search-console/performance/search-analytics?resource_id=${encodeURIComponent(site)}`,
  );
  console.log(
    '     Filter: last 7 days, group by Page, filter Page contains "/hi/" (and "/ta/", etc.)',
  );
  console.log('     Pass criteria: impressions > 0 for ANY Indic locale.');
  console.log(`     Indic locales: ${INDIC_LOCALES.join(', ')}`);
}

// ──────────────────────────────────────────────────────────────────────────
// GSC sitemap coverage
// ──────────────────────────────────────────────────────────────────────────

export interface SitemapCoverage {
  feedpath: string;
  submitted: number;
  indexed: number;
  pct: number;
}

export async function fetchSitemapCoverage(
  token: string,
  site: string,
): Promise<SitemapCoverage[] | { error: string }> {
  // GET https://searchconsole.googleapis.com/webmasters/v3/sites/{siteUrl}/sitemaps
  // Returns: { sitemap: [{ path, lastSubmitted, contents: [{ submitted, indexed }] }] }
  const url = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/sitemaps`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return { error: `GSC sitemaps ${r.status}: ${(await r.text()).slice(0, 300)}` };
  const json = (await r.json()) as {
    sitemap?: Array<{
      path: string;
      contents?: Array<{ type?: string; submitted?: string; indexed?: string }>;
    }>;
  };
  const out: SitemapCoverage[] = [];
  for (const sm of json.sitemap ?? []) {
    let submitted = 0;
    let indexed = 0;
    for (const c of sm.contents ?? []) {
      submitted += Number(c.submitted ?? 0);
      indexed += Number(c.indexed ?? 0);
    }
    out.push({
      feedpath: sm.path,
      submitted,
      indexed,
      pct: submitted === 0 ? 0 : (indexed / submitted) * 100,
    });
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
// GSC search analytics — Indic impressions
// ──────────────────────────────────────────────────────────────────────────

export interface IndicImpressionStat {
  lang: string;
  impressions: number;
  clicks: number;
}

export async function fetchIndicImpressions(
  token: string,
  site: string,
  startDate: string,
  endDate: string,
): Promise<IndicImpressionStat[] | { error: string }> {
  // POST https://searchconsole.googleapis.com/webmasters/v3/sites/{siteUrl}/searchAnalytics/query
  const url = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`;
  // Group by Page, fetch top 25k rows (default page-size cap). One call,
  // then bucket by URL locale prefix in code.
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      startDate,
      endDate,
      dimensions: ['page'],
      rowLimit: 25000,
    }),
  });
  if (!r.ok) return { error: `GSC searchAnalytics ${r.status}: ${(await r.text()).slice(0, 300)}` };
  const json = (await r.json()) as {
    rows?: Array<{ keys?: string[]; impressions?: number; clicks?: number }>;
  };
  const byLang = new Map<string, { impressions: number; clicks: number }>();
  for (const lang of INDIC_LOCALES) byLang.set(lang, { impressions: 0, clicks: 0 });
  for (const row of json.rows ?? []) {
    const page = row.keys?.[0] ?? '';
    try {
      const u = new URL(page);
      const m = u.pathname.match(/^\/([a-z]{2,3})(\/|$)/);
      if (m && INDIC_LOCALES.includes(m[1])) {
        const e = byLang.get(m[1]);
        if (e) {
          e.impressions += Number(row.impressions ?? 0);
          e.clicks += Number(row.clicks ?? 0);
        }
      }
    } catch {
      // ignore malformed URL
    }
  }
  return [...byLang.entries()].map(([lang, v]) => ({
    lang,
    impressions: v.impressions,
    clicks: v.clicks,
  }));
}

// ──────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────

export async function main(): Promise<number> {
  console.log('SEO Phase 8 — T+7d measurement');
  console.log('-'.repeat(60));

  const token = process.env.GSC_ACCESS_TOKEN;
  const site = process.env.GSC_SITE_URL ?? 'sc-domain:sohamhamso.org';

  if (!token) {
    printManualChecklist(site);
    // GitHub Actions surfaces this as a workflow annotation.
    if (process.env.GITHUB_ACTIONS === 'true') {
      console.log(
        '::warning title=GSC Phase 8 T+7d::Manual checklist required (GSC_ACCESS_TOKEN unset)',
      );
    }
    return 0;
  }

  console.log(`  GSC site: ${site}`);
  console.log('');

  // ── Coverage ────────────────────────────────────────────────────────
  console.log('[1/2] GSC Coverage — % submitted-and-indexed per sitemap');
  console.log('-'.repeat(60));
  const cov = await fetchSitemapCoverage(token, site);
  let coverageFail = false;
  if ('error' in cov) {
    console.error(`  [FAIL] ${cov.error}`);
    coverageFail = true;
  } else {
    console.log(`  ${'Sitemap'.padEnd(48)} ${'Submitted'.padEnd(11)} ${'Indexed'.padEnd(9)} %`);
    let totalSubmitted = 0;
    let totalIndexed = 0;
    for (const c of cov) {
      const flag = c.pct >= COVERAGE_THRESHOLD ? '[ok]' : '[FAIL]';
      if (c.pct < COVERAGE_THRESHOLD) coverageFail = true;
      console.log(
        `  ${c.feedpath.slice(-48).padEnd(48)} ${String(c.submitted).padEnd(11)} ${String(c.indexed).padEnd(9)} ${c.pct.toFixed(1)}% ${flag}`,
      );
      totalSubmitted += c.submitted;
      totalIndexed += c.indexed;
    }
    const overall = totalSubmitted === 0 ? 0 : (totalIndexed / totalSubmitted) * 100;
    console.log(
      `  ${'TOTAL'.padEnd(48)} ${String(totalSubmitted).padEnd(11)} ${String(totalIndexed).padEnd(9)} ${overall.toFixed(1)}%`,
    );
    console.log(`  Threshold: ≥${COVERAGE_THRESHOLD}%`);
  }

  // ── Indic impressions ──────────────────────────────────────────────
  console.log('');
  console.log('[2/2] GSC Performance — Indic-language query impressions (last 7d)');
  console.log('-'.repeat(60));
  const end = new Date();
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const imp = await fetchIndicImpressions(token, site, iso(start), iso(end));
  let impressionsFail = false;
  if ('error' in imp) {
    console.error(`  [FAIL] ${imp.error}`);
    impressionsFail = true;
  } else {
    console.log(`  ${'Lang'.padEnd(6)} ${'Impressions'.padEnd(13)} Clicks`);
    let total = 0;
    for (const s of imp) {
      console.log(`  ${s.lang.padEnd(6)} ${String(s.impressions).padEnd(13)} ${s.clicks}`);
      total += s.impressions;
    }
    const flag = total > 0 ? '[ok]' : '[FAIL]';
    console.log(`  Total Indic impressions: ${total}  ${flag}`);
    if (total === 0) impressionsFail = true;
  }

  console.log('');
  console.log('══════════════════════════════════════════════════════════');
  console.log('Summary');
  console.log('══════════════════════════════════════════════════════════');
  console.log(`  Coverage ≥${COVERAGE_THRESHOLD}%:           ${coverageFail ? 'FAIL' : 'PASS'}`);
  console.log(`  Indic impressions > 0:    ${impressionsFail ? 'FAIL' : 'PASS'}`);

  return coverageFail || impressionsFail ? 1 : 0;
}

if (import.meta.main) {
  const code = await main();
  process.exit(code);
}
