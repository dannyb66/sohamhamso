#!/usr/bin/env bun
/**
 * demand-dashboard — weekly Phase 2 demand-gate readout.
 *
 * One combined readout for the demand checkpoint in docs/INGESTION.md
 * (Step 1 — Discover → demand-gate note, 2026-06-10):
 *   [1/4] Subscribers      — count + 7-day growth (Turso PII DB, COUNTS ONLY)
 *   [2/4] CF Web Analytics — pageviews + visits (GraphQL RUM dataset)
 *   [3/4] GSC              — impressions + clicks (searchAnalytics/query)
 *   [4/4] Per-text demand  — search-miss counts + Phase 2 slug/alias
 *                            interest (search_misses table + CF 404 paths)
 *
 * Every section degrades gracefully to "unavailable (missing env)" — the
 * script NEVER throws on absent credentials, so the weekly cron stays
 * green while the operator wires secrets up incrementally.
 *
 * PRIVACY POSTURE (load-bearing — do not weaken):
 *   The Turso PII DB holds subscriber email hashes. This script issues
 *   COUNT(*)-only queries — `assertCountsOnlySql()` rejects any SQL that
 *   selects columns or references email/email_hash, enforced in code at
 *   the single query chokepoint, not by convention.
 *
 * Usage:
 *   bun scripts/demand-dashboard.ts
 *
 * Env vars (see .env.example):
 *   TURSO_PII_URL + TURSO_PII_AUTH_TOKEN       subscriber counts (read-only)
 *   TURSO_CORPUS_URL + TURSO_CORPUS_AUTH_TOKEN search_misses readout
 *   CF_ANALYTICS_TOKEN + CF_ACCOUNT_ID         CF Web Analytics pageviews
 *   CF_ZONE_ID                                 (optional) Phase 2 slug 404s
 *   GSC_ACCESS_TOKEN + GSC_SITE_URL            GSC impressions/clicks
 *
 * Pattern-matched on scripts/seo-phase8-tplus30d.ts (GSC plumbing) and
 * scripts/seo-phase8-tplus24h.ts (CF GraphQL plumbing).
 */

import { appendFileSync } from 'node:fs';

// ──────────────────────────────────────────────────────────────────────────
// Windows
// ──────────────────────────────────────────────────────────────────────────

/** Trailing window for subscriber growth (days). */
export const GROWTH_WINDOW_DAYS = 7;
/** Trailing window for search-miss aggregation (days). */
export const MISS_WINDOW_DAYS = 28;

/** YYYY-MM-DD (UTC) for `now - days`. Exported for unit tests. */
export function isoDayAgo(days: number, now: Date = new Date()): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// ──────────────────────────────────────────────────────────────────────────
// PII guard — COUNTS ONLY
// ──────────────────────────────────────────────────────────────────────────

/**
 * Reject any SQL against the PII DB that is not a bare COUNT aggregate.
 * Two independent checks (defense in depth):
 *   1. The statement must be a single `SELECT COUNT(*) ... FROM subscribers`
 *      — no other select-list shape passes.
 *   2. The string must never mention `email` (covers both `email` and
 *      `email_hash` columns) anywhere, including WHERE clauses.
 *
 * Throws on violation. Exported for unit-test coverage.
 */
export function assertCountsOnlySql(sql: string): void {
  if (/email/i.test(sql)) {
    throw new Error(`PII guard: query references an email column: ${sql}`);
  }
  if (!/^\s*SELECT\s+COUNT\(\*\)(\s+AS\s+\w+)?\s+FROM\s+subscribers\b/i.test(sql)) {
    throw new Error(`PII guard: only COUNT(*) FROM subscribers is allowed: ${sql}`);
  }
  // Single statement only — no piggybacked second statement.
  if (sql.replace(/;\s*$/, '').includes(';')) {
    throw new Error(`PII guard: multi-statement SQL rejected: ${sql}`);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Phase 2 slug/alias interest matching (pure — unit-tested)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Phase 2 next-up texts (docs/INGESTION.md Step 1) with the romanization
 * variants a reader might search for or type into a URL. Same
 * sound-equivalence rules of thumb as src/lib/aliases.ts (vocalic ṛ →
 * r/ri, ś → s/sh, sandhi → spelled-out). Variants are matched as
 * substrings of the DIACRITIC-STRIPPED query/path, so `parātrīśikā`
 * matches the `paratrisika` variant.
 */
export const PHASE2_TEXTS: ReadonlyArray<{ slug: string; variants: readonly string[] }> = [
  { slug: 'paratrisika', variants: ['paratrisika', 'paratrishika', 'paratrimsika'] },
  {
    slug: 'isvarapratyabhijna-karika',
    variants: [
      'isvarapratyabhijna',
      'ishvarapratyabhijna',
      'pratyabhijna karika',
      'pratyabhijna-karika',
    ],
  },
  { slug: 'sivadrsti', variants: ['sivadrsti', 'shivadrishti', 'sivadristi', 'shivadrsti'] },
  { slug: 'tantrasara', variants: ['tantrasara'] },
  { slug: 'gitartha-samgraha', variants: ['gitartha'] },
  { slug: 'mahanirvana-tantra', variants: ['mahanirvana'] },
];

/**
 * Normalize a search query or URL path for Phase 2 matching:
 * lowercase, strip combining diacritics (NFD), and keep `-`/space/`/`
 * separators intact so hyphenated variants still match.
 * Exported for unit-test coverage.
 */
export function normalizeForMatch(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFD')
      // biome-ignore lint/suspicious/noMisleadingCharacterClass: standalone combining marks post-NFD are the target
      .replace(/[\u0300-\u036f]/g, '')
  );
}

export interface Phase2Match {
  slug: string;
  hits: number;
  samples: string[];
}

/**
 * Bucket (value, count) rows — search-miss queries or 404 paths — by the
 * Phase 2 text they reference. Substring match on the normalized value.
 * Rows matching nothing are dropped. Exported for unit-test coverage.
 */
export function matchPhase2(rows: ReadonlyArray<{ value: string; n: number }>): Phase2Match[] {
  const bySlug = new Map<string, { hits: number; samples: string[] }>();
  for (const row of rows) {
    const norm = normalizeForMatch(row.value);
    for (const text of PHASE2_TEXTS) {
      if (!text.variants.some((v) => norm.includes(v))) continue;
      const e = bySlug.get(text.slug) ?? { hits: 0, samples: [] };
      e.hits += row.n;
      if (e.samples.length < 3) e.samples.push(row.value);
      bySlug.set(text.slug, e);
      break; // one bucket per row — variants are disjoint enough
    }
  }
  return [...bySlug.entries()]
    .map(([slug, e]) => ({ slug, hits: e.hits, samples: e.samples }))
    .sort((a, b) => b.hits - a.hits);
}

// ──────────────────────────────────────────────────────────────────────────
// Output accumulator — console + GITHUB_STEP_SUMMARY
// ──────────────────────────────────────────────────────────────────────────

const _lines: string[] = [];

function out(line = ''): void {
  console.log(line);
  _lines.push(line);
}

function flushStepSummary(): void {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  try {
    appendFileSync(path, `## Demand dashboard\n\n\`\`\`\n${_lines.join('\n')}\n\`\`\`\n`);
  } catch {
    // Summary is cosmetic — never fail the run over it.
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Turso helpers (libsql over HTTPS — same client the edge backends use)
// ──────────────────────────────────────────────────────────────────────────

interface LibsqlLike {
  execute(q: {
    sql: string;
    args: Array<string | number | null>;
  }): Promise<{ rows: Record<string, unknown>[] }>;
}

async function makeTursoClient(url: string, authToken: string): Promise<LibsqlLike> {
  const { createClient } = await import('@libsql/client/web');
  return createClient({ url, authToken });
}

/** COUNT(*) chokepoint for the PII DB — every PII query goes through here. */
async function piiCount(
  client: LibsqlLike,
  sql: string,
  args: Array<string | number | null> = [],
): Promise<number> {
  assertCountsOnlySql(sql);
  const res = await client.execute({ sql, args });
  return Number(res.rows[0]?.n ?? 0);
}

// ──────────────────────────────────────────────────────────────────────────
// [1/4] Subscribers (Turso PII — COUNTS ONLY)
// ──────────────────────────────────────────────────────────────────────────

async function sectionSubscribers(): Promise<void> {
  out('');
  out('[1/4] Subscribers (Turso PII — counts only)');
  out('-'.repeat(60));
  const url = process.env.TURSO_PII_URL;
  const token = process.env.TURSO_PII_AUTH_TOKEN;
  if (!url || !token) {
    out('  unavailable (missing env: TURSO_PII_URL / TURSO_PII_AUTH_TOKEN)');
    return;
  }
  try {
    const client = await makeTursoClient(url, token);
    const total = await piiCount(client, 'SELECT COUNT(*) AS n FROM subscribers');
    const since = isoDayAgo(GROWTH_WINDOW_DAYS);
    const recent = await piiCount(
      client,
      'SELECT COUNT(*) AS n FROM subscribers WHERE subscribed_at >= ?',
      [since],
    );
    out(`  Total subscribers:        ${total}`);
    out(`  New in last ${GROWTH_WINDOW_DAYS}d:          ${recent} (since ${since})`);
  } catch (e) {
    out(`  unavailable (query failed: ${(e as Error).message.slice(0, 120)})`);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// [2/4] CF Web Analytics (GraphQL RUM dataset)
// ──────────────────────────────────────────────────────────────────────────

async function sectionCfWebAnalytics(): Promise<void> {
  out('');
  out(`[2/4] CF Web Analytics — pageviews/visits (last ${GROWTH_WINDOW_DAYS}d)`);
  out('-'.repeat(60));
  const token = process.env.CF_ANALYTICS_TOKEN;
  const accountTag = process.env.CF_ACCOUNT_ID;
  if (!token || !accountTag) {
    out('  unavailable (missing env: CF_ANALYTICS_TOKEN / CF_ACCOUNT_ID)');
    return;
  }
  // RUM beacon dataset (Web Analytics), account-scoped — distinct from the
  // zone-scoped httpRequestsAdaptiveGroups used by seo-phase8-tplus24h.
  const query = `
    query DemandRum($accountTag: String!, $since: Date!, $until: Date!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          rumPageloadEventsAdaptiveGroups(
            limit: 1
            filter: { date_geq: $since, date_leq: $until }
          ) {
            count
            sum { visits }
          }
        }
      }
    }
  `;
  try {
    const r = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        variables: { accountTag, since: isoDayAgo(GROWTH_WINDOW_DAYS), until: isoDayAgo(0) },
      }),
    });
    if (!r.ok) {
      out(`  unavailable (CF API ${r.status}: ${(await r.text()).slice(0, 120)})`);
      return;
    }
    const json = (await r.json()) as {
      data?: {
        viewer?: {
          accounts?: Array<{
            rumPageloadEventsAdaptiveGroups?: Array<{ count?: number; sum?: { visits?: number } }>;
          }>;
        };
      };
      errors?: unknown;
    };
    if (json.errors) {
      out(`  unavailable (CF GraphQL errors: ${JSON.stringify(json.errors).slice(0, 120)})`);
      return;
    }
    const group = json.data?.viewer?.accounts?.[0]?.rumPageloadEventsAdaptiveGroups?.[0];
    out(`  Pageviews:                ${group?.count ?? 0}`);
    out(`  Visits:                   ${group?.sum?.visits ?? 0}`);
  } catch (e) {
    out(`  unavailable (fetch failed: ${(e as Error).message.slice(0, 120)})`);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// [3/4] GSC impressions/clicks
// ──────────────────────────────────────────────────────────────────────────

async function sectionGsc(): Promise<void> {
  out('');
  out(`[3/4] GSC — impressions/clicks (last ${GROWTH_WINDOW_DAYS}d, 2d data lag)`);
  out('-'.repeat(60));
  const token = process.env.GSC_ACCESS_TOKEN;
  const site = process.env.GSC_SITE_URL ?? 'sc-domain:sohamhamso.org';
  if (!token) {
    out('  unavailable (missing env: GSC_ACCESS_TOKEN)');
    return;
  }
  // Same searchAnalytics/query endpoint as seo-phase8-tplus7d.ts, but
  // dimensionless — one aggregate row over the window. GSC data lags
  // ~2 days, so the window ends at T-2.
  const endDate = isoDayAgo(2);
  const startDate = isoDayAgo(2 + GROWTH_WINDOW_DAYS - 1);
  const url = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ startDate, endDate, dimensions: [], rowLimit: 1 }),
    });
    if (!r.ok) {
      out(`  unavailable (GSC ${r.status}: ${(await r.text()).slice(0, 120)})`);
      return;
    }
    const json = (await r.json()) as {
      rows?: Array<{ impressions?: number; clicks?: number }>;
    };
    const row = json.rows?.[0];
    out(`  Window:                   ${startDate} → ${endDate}`);
    out(`  Impressions:              ${row?.impressions ?? 0}`);
    out(`  Clicks:                   ${row?.clicks ?? 0}`);
  } catch (e) {
    out(`  unavailable (fetch failed: ${(e as Error).message.slice(0, 120)})`);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// [4/4] Per-text demand — search misses + Phase 2 slug 404/alias interest
// ──────────────────────────────────────────────────────────────────────────

async function sectionPerTextDemand(): Promise<void> {
  out('');
  out(`[4/4] Per-text demand (last ${MISS_WINDOW_DAYS}d)`);
  out('-'.repeat(60));

  // ── Search misses (search_misses table, written by src/lib/search-miss.ts)
  const url = process.env.TURSO_CORPUS_URL;
  const token = process.env.TURSO_CORPUS_AUTH_TOKEN;
  let missRows: Array<{ value: string; n: number }> = [];
  if (!url || !token) {
    out('  Search misses: unavailable (missing env: TURSO_CORPUS_URL / TURSO_CORPUS_AUTH_TOKEN)');
  } else {
    try {
      const client = await makeTursoClient(url, token);
      const res = await client.execute({
        sql: `SELECT query, COUNT(*) AS n FROM search_misses
              WHERE day >= ? GROUP BY query ORDER BY n DESC LIMIT 50`,
        args: [isoDayAgo(MISS_WINDOW_DAYS)],
      });
      missRows = res.rows.map((r) => ({ value: String(r.query ?? ''), n: Number(r.n ?? 0) }));
      const totalMisses = missRows.reduce((a, r) => a + r.n, 0);
      out(`  Search misses:            ${totalMisses} (distinct queries: ${missRows.length})`);
      for (const r of missRows.slice(0, 10)) {
        out(`    ${String(r.n).padStart(4)}  ${r.value}`);
      }
    } catch (e) {
      // A fresh corpus DB has no search_misses table until the first miss
      // lands — that's "no data yet", not an error worth a red run.
      const msg = (e as Error).message;
      if (/no such table/i.test(msg)) {
        out('  Search misses:            0 (table not created yet — no misses recorded)');
      } else {
        out(`  Search misses: unavailable (query failed: ${msg.slice(0, 120)})`);
      }
    }
  }

  // ── Phase 2 slug 404 interest (CF zone analytics, optional)
  const cfToken = process.env.CF_ANALYTICS_TOKEN;
  const zoneId = process.env.CF_ZONE_ID;
  let pathRows: Array<{ value: string; n: number }> = [];
  if (!cfToken || !zoneId) {
    out('  Slug 404 interest: unavailable (missing env: CF_ANALYTICS_TOKEN / CF_ZONE_ID)');
  } else {
    // 404-only filter keeps the row count tiny; group by path and match
    // Phase 2 variants in code. Same dataset as seo-phase8-tplus24h.
    const query = `
      query Demand404($zoneId: String!, $since: Time!, $until: Time!) {
        viewer {
          zones(filter: { zoneTag: $zoneId }) {
            httpRequestsAdaptiveGroups(
              limit: 10000
              filter: { datetime_geq: $since, datetime_leq: $until, edgeResponseStatus: 404 }
            ) {
              count
              dimensions { clientRequestPath }
            }
          }
        }
      }
    `;
    const until = new Date();
    const since = new Date(until.getTime() - GROWTH_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    try {
      const r = await fetch('https://api.cloudflare.com/client/v4/graphql', {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          variables: { zoneId, since: since.toISOString(), until: until.toISOString() },
        }),
      });
      const json = (await r.json()) as {
        data?: {
          viewer?: {
            zones?: Array<{
              httpRequestsAdaptiveGroups?: Array<{
                count: number;
                dimensions: { clientRequestPath: string };
              }>;
            }>;
          };
        };
        errors?: unknown;
      };
      if (!r.ok || json.errors) {
        out(
          `  Slug 404 interest: unavailable (CF GraphQL: ${JSON.stringify(json.errors ?? r.status).slice(0, 120)})`,
        );
      } else {
        const rows = json.data?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups ?? [];
        pathRows = rows.map((row) => ({ value: row.dimensions.clientRequestPath, n: row.count }));
        out(`  404 paths (last ${GROWTH_WINDOW_DAYS}d):     ${pathRows.length} distinct`);
      }
    } catch (e) {
      out(`  Slug 404 interest: unavailable (fetch failed: ${(e as Error).message.slice(0, 120)})`);
    }
  }

  // ── Phase 2 matcher over both signals
  const matches = matchPhase2([...missRows, ...pathRows]);
  out('');
  out('  Phase 2 text interest (miss queries + 404 paths):');
  if (matches.length === 0) {
    out('    (no Phase 2 slug/alias hits in window)');
  } else {
    for (const m of matches) {
      out(`    ${m.slug.padEnd(28)} ${String(m.hits).padStart(4)}  e.g. ${m.samples.join(' | ')}`);
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────

export async function main(): Promise<number> {
  out(`Demand dashboard — ${isoDayAgo(0)}`);
  out('═'.repeat(60));

  // Each section catches its own errors; the belt-and-braces catch here
  // guarantees the cron never goes red over a flaky upstream.
  for (const section of [
    sectionSubscribers,
    sectionCfWebAnalytics,
    sectionGsc,
    sectionPerTextDemand,
  ]) {
    try {
      await section();
    } catch (e) {
      out(`  unavailable (unexpected: ${(e as Error).message.slice(0, 120)})`);
    }
  }

  out('');
  out('═'.repeat(60));
  out('Thresholds: see docs/INGESTION.md demand-gate note (2026-06-10) —');
  out('Waves 3-6 checkpoint ~2026-07-10 with pre-registered numbers.');
  flushStepSummary();
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
