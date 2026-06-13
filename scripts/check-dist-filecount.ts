#!/usr/bin/env bun
/**
 * check-dist-filecount.ts
 *
 * Counts files under dist/ and fails when the count exceeds the limit.
 * Cloudflare Pages hard-rejects deploys with more than 20,000 files; we gate
 * at 18,000 to get an early warning while there is still headroom to act.
 *
 * MARGIN STORY (A6 phase 2, 2026-06): verse pages are now SERVER-RENDERED
 * (`prerender = false` on the two verse routes) — dist/ no longer contains
 * one HTML file per verse × locale, which dropped the count from ~8,900 to
 * ~2,200. File growth is now driven by chapter/text/lemma pages and assets
 * (roughly: 12 files per new chapter, not 12 per verse), so un-staging the
 * two sourced texts (226 verses) costs dozens of files, not ~10k. The
 * 18,000 gate stays as a tripwire in case a future route reintroduces
 * per-verse static output.
 *
 * Exit 0 — file count within limit; prints the count.
 * Exit 1 — file count above limit (deploy is at risk).
 * Exit 2 — dist/ does not exist (build first: `bun run seo:build`).
 *
 * Run: bun scripts/check-dist-filecount.ts [distDir] [--limit N]
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const DEFAULT_LIMIT = 18_000;
export const CF_PAGES_HARD_LIMIT = 20_000;

/** Recursively count regular files under `dir` (symlinks count as files). */
export function countFiles(dir: string): number {
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      count += countFiles(full);
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      count += 1;
    } else if (statSync(full).isFile()) {
      count += 1;
    }
  }
  return count;
}

export interface FilecountResult {
  distDir: string;
  count: number;
  limit: number;
  ok: boolean;
}

export function checkDistFilecount(
  distDir: string,
  limit: number = DEFAULT_LIMIT,
): FilecountResult {
  const count = countFiles(distDir);
  return { distDir, count, limit, ok: count <= limit };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(argv: string[]): number {
  let distDir = 'dist';
  let limit = DEFAULT_LIMIT;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit' && argv[i + 1]) {
      limit = Number.parseInt(argv[++i], 10);
    } else if (a && !a.startsWith('-')) {
      distDir = a;
    }
  }

  const dir = resolve(distDir);
  if (!existsSync(dir)) {
    console.error(`check-dist-filecount: ${dir} not found — build first (\`bun run seo:build\`).`);
    return 2;
  }

  const result = checkDistFilecount(dir, limit);
  if (!result.ok) {
    console.error(
      `check-dist-filecount: FAIL — ${result.count} files in ${distDir}/ exceeds the ` +
        `${result.limit}-file gate (Cloudflare Pages rejects deploys above ${CF_PAGES_HARD_LIMIT}).`,
    );
    console.error(
      'See plan item A6: move verse pages to SSR/CI-built DB instead of one static file per route.',
    );
    return 1;
  }

  console.log(
    `check-dist-filecount: OK — ${result.count} files in ${distDir}/ ` +
      `(limit ${result.limit}; Cloudflare Pages hard limit ${CF_PAGES_HARD_LIMIT}).`,
  );
  return 0;
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
