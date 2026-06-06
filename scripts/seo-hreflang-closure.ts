#!/usr/bin/env bun
/**
 * seo-hreflang-closure.ts
 *
 * Verifies that every hreflang cluster in the built site forms a closed,
 * bidirectional graph.
 *
 * For every (sourceUrl, lang, targetUrl) triple extracted from the dist:
 *   1. The targetUrl must exist as a known page in the graph (no orphans).
 *   2. targetUrl must emit a hreflang entry pointing back to sourceUrl
 *      (same lang or as x-default). (standard SEO reciprocity rule)
 *   3. Every page that emits hreflang entries must include an x-default.
 *
 * Exit 0 — all clusters closed; prints summary line.
 * Exit 1 — violations found; prints JSON array to stderr.
 *
 * Run: bun scripts/seo-hreflang-closure.ts
 */

import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { collectHtmlFiles, inferRoutePath, toPageUrl, resolveSiteOrigin } from './seo-validate';

const DIST_DIR = resolve('dist');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HreflangEntry {
  hrefLang: string;
  href: string;
}

export interface Violation {
  source: string;
  lang: string;
  target: string;
  issue:
    | 'orphan-hreflang'
    | 'asymmetric-hreflang'
    | 'missing-x-default';
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse all <link rel="alternate" hreflang="X" href="Y"> tags from HTML.
 * Uses a single-pass regex — no DOM parser required.
 */
export function parseHreflangTags(html: string): HreflangEntry[] {
  const entries: HreflangEntry[] = [];
  // Match <link ...> tags that contain both rel="alternate" and hreflang=
  const linkTagRe = /<link\b[^>]*>/gi;
  for (const tag of html.match(linkTagRe) ?? []) {
    const relMatch = tag.match(/\brel=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const rel = (relMatch?.[1] ?? relMatch?.[2] ?? relMatch?.[3] ?? '').toLowerCase();
    if (!rel.includes('alternate')) continue;

    const hreflangMatch = tag.match(/\bhreflang=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const hrefLang = (hreflangMatch?.[1] ?? hreflangMatch?.[2] ?? hreflangMatch?.[3] ?? '').toLowerCase();
    if (!hrefLang) continue;

    const hrefMatch = tag.match(/\bhref=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const href = hrefMatch?.[1] ?? hrefMatch?.[2] ?? hrefMatch?.[3] ?? '';
    if (!href) continue;

    entries.push({ hrefLang, href });
  }
  return entries;
}

/** Normalize an href to an absolute URL string, stripping trailing slash and hash. */
export function normalizeHref(href: string, baseOrigin: string): string | null {
  try {
    const url = new URL(href, `${baseOrigin}/`);
    url.hash = '';
    // Remove trailing slash for non-root paths for consistent keys
    const path = url.pathname.replace(/\/+$/, '') || '/';
    url.pathname = path;
    return url.toString();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Graph construction
// ---------------------------------------------------------------------------

export interface PageNode {
  /** Absolute canonical URL for this page */
  canonicalUrl: string;
  /** All hreflang entries emitted by this page, keyed by normalised href */
  hreflangByHref: Map<string, string>; // normalizedHref → hrefLang
}

/**
 * Pure function: walk a pre-built hreflang graph and return all violations.
 * Extracted from main() so tests can exercise the logic without file I/O.
 */
export function checkHreflangGraph(graph: Map<string, PageNode>): Violation[] {
  const violations: Violation[] = [];

  for (const [sourceUrl, node] of graph) {
    if (node.hreflangByHref.size === 0) continue;

    let hasXDefault = false;

    for (const [targetUrl, lang] of node.hreflangByHref) {
      if (lang === 'x-default') {
        hasXDefault = true;
        continue;
      }

      const targetNode = graph.get(targetUrl);

      if (!targetNode) {
        violations.push({ source: sourceUrl, lang, target: targetUrl, issue: 'orphan-hreflang' });
        continue;
      }

      const targetPointsBack = targetNode.hreflangByHref.has(sourceUrl);
      if (!targetPointsBack) {
        violations.push({ source: sourceUrl, lang, target: targetUrl, issue: 'asymmetric-hreflang' });
      }
    }

    if (!hasXDefault) {
      const nonDefaultEntries = [...node.hreflangByHref.keys()].filter(
        (href) => node.hreflangByHref.get(href) !== 'x-default',
      );
      if (nonDefaultEntries.length > 0) {
        violations.push({ source: sourceUrl, lang: 'x-default', target: '', issue: 'missing-x-default' });
      }
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  const siteOrigin = await resolveSiteOrigin();

  const files = await collectHtmlFiles(DIST_DIR);

  // Build the graph: normalizedUrl → PageNode
  const graph = new Map<string, PageNode>();

  await Promise.all(
    files.map(async (filePath) => {
      const routePath = inferRoutePath(DIST_DIR, filePath);
      const pageUrl = toPageUrl(routePath, siteOrigin);
      // Normalize for consistent key
      const normalizedPage = normalizeHref(pageUrl, siteOrigin);
      if (!normalizedPage) return;

      const html = await readFile(filePath, 'utf8');
      const entries = parseHreflangTags(html);

      const hreflangByHref = new Map<string, string>();
      for (const entry of entries) {
        const normalized = normalizeHref(entry.href, siteOrigin);
        if (normalized) {
          hreflangByHref.set(normalized, entry.hrefLang);
        }
      }

      graph.set(normalizedPage, { canonicalUrl: normalizedPage, hreflangByHref });
    }),
  );

  const violations: Violation[] = [];
  let totalHreflangLinks = 0;

  for (const [sourceUrl, node] of graph) {
    if (node.hreflangByHref.size === 0) continue;

    let hasXDefault = false;

    for (const [targetUrl, lang] of node.hreflangByHref) {
      totalHreflangLinks++;

      if (lang === 'x-default') {
        hasXDefault = true;
        // x-default is a pointer to canonical default; no reciprocity required
        continue;
      }

      const targetNode = graph.get(targetUrl);

      // Violation 1: orphan — target URL not in the built graph
      if (!targetNode) {
        violations.push({ source: sourceUrl, lang, target: targetUrl, issue: 'orphan-hreflang' });
        continue;
      }

      // Violation 2: asymmetric — targetNode must have a hreflang pointing back
      // to sourceUrl (any lang value is acceptable — the cluster is shared).
      // Standard rule: A→B means B must link back to A, using the lang of A's
      // page (which is implicitly "the lang key that points to sourceUrl in B's
      // cluster"). We require at minimum that B contains sourceUrl as a target.
      const targetPointsBack = targetNode.hreflangByHref.has(sourceUrl);
      if (!targetPointsBack) {
        violations.push({
          source: sourceUrl,
          lang,
          target: targetUrl,
          issue: 'asymmetric-hreflang',
        });
      }
    }

    // Violation 3: missing x-default on a page that emits hreflang entries
    if (!hasXDefault) {
      // Count non-x-default entries to avoid flagging pages that emit nothing
      const nonDefaultEntries = [...node.hreflangByHref.keys()].filter(
        (href) => node.hreflangByHref.get(href) !== 'x-default',
      );
      if (nonDefaultEntries.length > 0) {
        violations.push({
          source: sourceUrl,
          lang: 'x-default',
          target: '',
          issue: 'missing-x-default',
        });
      }
    }
  }

  if (violations.length > 0) {
    const orphans = violations.filter((v) => v.issue === 'orphan-hreflang').length;
    const asymmetric = violations.filter((v) => v.issue === 'asymmetric-hreflang').length;
    const missingXDefault = violations.filter((v) => v.issue === 'missing-x-default').length;

    console.error(
      `Hreflang closure: FAIL — ${violations.length} violation(s): ` +
        `${orphans} orphan, ${asymmetric} asymmetric, ${missingXDefault} missing-x-default.`,
    );
    console.error(JSON.stringify(violations, null, 2));
    return 1;
  }

  const pagesWithHreflang = [...graph.values()].filter((n) => n.hreflangByHref.size > 0).length;
  console.log(
    `Hreflang closure: PASS — ${graph.size} URLs, ${totalHreflangLinks} total hreflang links, all bidirectional.`,
  );
  console.log(`Pages with hreflang clusters: ${pagesWithHreflang}.`);
  return 0;
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
