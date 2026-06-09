#!/usr/bin/env bun
/**
 * seo-cf-logpush-tail — download the latest Logpush dumps from R2 and
 * summarize 4xx/5xx/0-byte/OG/sitemap-cache patterns.
 *
 * Why this exists:
 *   During the 72h post-launch window, an operator wants quick visibility
 *   into edge-observed problems without spinning up a full log pipeline.
 *   This script pulls the most recent batch files from
 *   r2://sohamhamso-backups/logpush/72h-post-launch/, gunzips them,
 *   and prints sorted summary tables.
 *
 * Usage:
 *   bun scripts/seo-cf-logpush-tail.ts                # latest hour
 *   bun scripts/seo-cf-logpush-tail.ts --hour=3       # 3 hours back
 *   bun scripts/seo-cf-logpush-tail.ts --dry-run      # print wrangler cmds only
 *
 * Requires: `wrangler` on PATH and authenticated against the same CF
 * account that owns sohamhamso-backups. No CF_API_TOKEN needed because
 * wrangler reads its own auth state.
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

const R2_BUCKET = 'sohamhamso-backups';
const R2_PREFIX = 'logpush/72h-post-launch';

interface ParsedArgs {
  dryRun: boolean;
  hoursBack: number;
}

function parseArgs(argv: string[]): ParsedArgs {
  let dryRun = false;
  let hoursBack = 1;
  for (const arg of argv) {
    if (arg === '--dry-run') dryRun = true;
    else if (arg.startsWith('--hour=')) {
      const v = Number.parseInt(arg.slice('--hour='.length), 10);
      if (Number.isInteger(v) && v > 0) hoursBack = v;
    }
  }
  return { dryRun, hoursBack };
}

interface R2Object {
  key: string;
  size: number;
  uploaded: string; // ISO timestamp
}

function listR2Objects(prefix: string, dryRun: boolean): R2Object[] {
  const cmd = `wrangler r2 object list ${R2_BUCKET} --prefix=${prefix} --json`;
  if (dryRun) {
    console.log(`  [dry-run] ${cmd}`);
    return [];
  }
  let stdout: string;
  try {
    stdout = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err: unknown) {
    stdout = (err as { stdout?: string }).stdout ?? '';
  }
  const match = stdout.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]);
    // wrangler shape varies by version: either {result: [...]} or [...] directly
    const list = Array.isArray(parsed) ? parsed : (parsed.result ?? parsed.objects ?? []);
    return (list as unknown[])
      .map((o) => {
        const obj = o as Record<string, unknown>;
        return {
          key: String(obj.key ?? obj.Key ?? ''),
          size: Number(obj.size ?? obj.Size ?? 0),
          uploaded: String(obj.uploaded ?? obj.last_modified ?? obj.LastModified ?? ''),
        };
      })
      .filter((o) => o.key.length > 0);
  } catch {
    return [];
  }
}

function getR2Object(key: string, destPath: string, dryRun: boolean): boolean {
  const cmd = `wrangler r2 object get ${R2_BUCKET}/${key} --file=${destPath}`;
  if (dryRun) {
    console.log(`  [dry-run] ${cmd}`);
    return false;
  }
  try {
    execSync(cmd, { stdio: ['ignore', 'ignore', 'pipe'] });
    return existsSync(destPath);
  } catch {
    return false;
  }
}

interface LogRecord {
  EdgeStartTimestamp?: string;
  ClientIP?: string;
  EdgeResponseStatus?: number;
  EdgeResponseBytes?: number;
  ClientRequestHost?: string;
  ClientRequestPath?: string;
  ClientRequestUserAgent?: string;
  ClientRequestReferer?: string;
  CacheCacheStatus?: string;
}

function parseNDJSON(buf: Buffer): LogRecord[] {
  const text = buf.toString('utf8');
  const records: LogRecord[] = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      records.push(JSON.parse(t) as LogRecord);
    } catch {
      // skip malformed lines
    }
  }
  return records;
}

interface Summary {
  status4xx: Map<string, number>; // key: `${status} ${path}`
  status5xx: Map<string, number>;
  zeroBodyOK: Map<string, number>; // path
  ogPaths: Map<string, { count: number; ok: number; bad: number }>;
  sitemapMiss: Map<string, number>;
  total: number;
}

function emptySummary(): Summary {
  return {
    status4xx: new Map(),
    status5xx: new Map(),
    zeroBodyOK: new Map(),
    ogPaths: new Map(),
    sitemapMiss: new Map(),
    total: 0,
  };
}

function bump(m: Map<string, number>, key: string): void {
  m.set(key, (m.get(key) ?? 0) + 1);
}

function classify(records: LogRecord[], sum: Summary): void {
  for (const r of records) {
    sum.total++;
    const status = Number(r.EdgeResponseStatus ?? 0);
    const path = r.ClientRequestPath ?? '/';
    const bytes = Number(r.EdgeResponseBytes ?? 0);
    const cache = r.CacheCacheStatus ?? '';

    if (status >= 400 && status < 500) {
      bump(sum.status4xx, `${status} ${path}`);
    } else if (status >= 500 && status < 600) {
      bump(sum.status5xx, `${status} ${path}`);
    }
    if (status === 200 && bytes === 0) {
      bump(sum.zeroBodyOK, path);
    }
    if (path.startsWith('/og/')) {
      const cur = sum.ogPaths.get(path) ?? { count: 0, ok: 0, bad: 0 };
      cur.count++;
      if (status === 200 && bytes > 0) cur.ok++;
      else cur.bad++;
      sum.ogPaths.set(path, cur);
    }
    const isSitemap = path === '/sitemap-index.xml' || path.startsWith('/sitemap-');
    if (isSitemap && cache.toUpperCase() === 'MISS') {
      bump(sum.sitemapMiss, path);
    }
  }
}

function printTable(title: string, rows: Array<[string, string]>): void {
  console.log(`\n## ${title}`);
  if (rows.length === 0) {
    console.log('  (no entries)');
    return;
  }
  const w0 = Math.max(...rows.map(([a]) => a.length), 8);
  console.log(`  ${'count'.padStart(6)}  ${'detail'.padEnd(w0)}`);
  console.log(`  ${'─'.repeat(6)}  ${'─'.repeat(w0)}`);
  for (const [label, count] of rows) {
    console.log(`  ${count.padStart(6)}  ${label.padEnd(w0)}`);
  }
}

function topRows(m: Map<string, number>, limit = 20): Array<[string, string]> {
  return Array.from(m.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k, v]) => [k, String(v)]);
}

function printSummary(sum: Summary): void {
  console.log(`\n[seo-cf-logpush-tail] processed ${sum.total} log records.`);
  printTable('4xx by status + path', topRows(sum.status4xx));
  printTable('5xx by status + path', topRows(sum.status5xx));
  printTable('0-byte 200 OK responses (silent failures)', topRows(sum.zeroBodyOK));

  // OG paths get a richer table
  console.log('\n## OG endpoint health (/og/*)');
  const ogRows = Array.from(sum.ogPaths.entries()).sort((a, b) => b[1].count - a[1].count);
  if (ogRows.length === 0) {
    console.log('  (no /og/* traffic in this window)');
  } else {
    console.log(`  ${'count'.padStart(6)}  ${'ok'.padStart(5)}  ${'bad'.padStart(5)}  path`);
    console.log(`  ${'─'.repeat(6)}  ${'─'.repeat(5)}  ${'─'.repeat(5)}  ${'─'.repeat(20)}`);
    for (const [path, v] of ogRows) {
      console.log(
        `  ${String(v.count).padStart(6)}  ${String(v.ok).padStart(5)}  ${String(v.bad).padStart(5)}  ${path}`,
      );
    }
  }

  printTable('Sitemap cache MISS (should be near-zero after warmup)', topRows(sum.sitemapMiss));
}

function selectRecentObjects(objects: R2Object[], hoursBack: number): R2Object[] {
  if (objects.length === 0) return [];
  const cutoffMs = Date.now() - hoursBack * 60 * 60 * 1000;
  const recent = objects.filter((o) => {
    if (!o.uploaded) return true;
    const t = Date.parse(o.uploaded);
    return Number.isFinite(t) && t >= cutoffMs;
  });
  // Sort by uploaded desc; if metadata missing, fall back to key lexicographic.
  recent.sort((a, b) => {
    const at = Date.parse(a.uploaded) || 0;
    const bt = Date.parse(b.uploaded) || 0;
    if (at !== bt) return bt - at;
    return b.key.localeCompare(a.key);
  });
  return recent;
}

async function main(): Promise<void> {
  const { dryRun, hoursBack } = parseArgs(process.argv.slice(2));

  console.log(
    `[seo-cf-logpush-tail] scanning r2://${R2_BUCKET}/${R2_PREFIX}/ (last ${hoursBack}h)`,
  );

  const objects = listR2Objects(R2_PREFIX, dryRun);
  if (dryRun) {
    console.log('[seo-cf-logpush-tail] DRY RUN — would also wrangler r2 object get each match.');
    return;
  }

  if (objects.length === 0) {
    console.log(
      '[seo-cf-logpush-tail] no objects found. Either no traffic yet, or the prefix is wrong, or wrangler is not authenticated.',
    );
    process.exit(1);
  }

  const recent = selectRecentObjects(objects, hoursBack);
  if (recent.length === 0) {
    console.log(`[seo-cf-logpush-tail] no objects uploaded in the last ${hoursBack}h.`);
    process.exit(0);
  }

  const tmpRoot = mkdtempSync(join(tmpdir(), 'logpush-tail-'));
  if (!existsSync(tmpRoot)) mkdirSync(tmpRoot, { recursive: true });
  const summary = emptySummary();

  for (let i = 0; i < recent.length; i++) {
    const obj = recent[i];
    const safeName = obj.key.replace(/[\/]/g, '_');
    const dest = join(tmpRoot, safeName);
    process.stdout.write(`  [${i + 1}/${recent.length}] ${obj.key} (${obj.size} bytes) ... `);
    const ok = getR2Object(obj.key, dest, false);
    if (!ok) {
      console.log('FAILED');
      continue;
    }
    const raw = readFileSync(dest);
    let buf: Buffer;
    try {
      buf = obj.key.endsWith('.gz') ? gunzipSync(raw) : raw;
    } catch {
      console.log('gunzip-failed');
      continue;
    }
    const records = parseNDJSON(buf);
    classify(records, summary);
    console.log(`${records.length} records`);
  }

  printSummary(summary);
}

main().catch((err) => {
  console.error('[seo-cf-logpush-tail] error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
