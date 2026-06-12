#!/usr/bin/env bun
/**
 * sohamhamso — translation fan-out orchestrator
 *
 * Drives runner.ts across the 11-language Indic fan-out for one text with
 * bounded concurrency, retries, and a per-run manifest. Each (text, lang)
 * chunk is a runner.ts subprocess invoked with --json; the runner re-queries
 * verses still lacking a translation, so a retry only re-attempts the verses
 * that failed (per-verse retry without re-translating successes).
 *
 * Hardening over a bare `for lang in ...; do bun runner.ts ...` loop:
 *   - bounded concurrency (default 3 langs in flight) so Phase 2 scale does
 *     not serialize ~33h of RATE_LIMIT_SLEEP_MS waits
 *   - exponential backoff retry on transient errors (rate limit, 5xx, network)
 *   - canonical translator label pinned per (text, lang) and passed through,
 *     so retried verses carry the same provenance as first-pass verses
 *   - per-run manifest JSONL at pipeline/translate/runs/<timestamp>-<slug>.jsonl
 *     (one row per lang chunk + a summary row)
 *   - NONZERO exit if any chunk failed; final stdout line is the JSON summary
 *
 * Usage:
 *   bun pipeline/translate/dispatch.ts --text siva-sutras
 *   bun pipeline/translate/dispatch.ts --text vijnana-bhairava --langs hi,ta --limit 5
 *   bun pipeline/translate/dispatch.ts --text siva-sutras --dry-run --concurrency 5
 *
 * Env:
 *   ANTHROPIC_API_KEY  required for live runs (dry-run works without)
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODEL_DISPLAY, type RunSummary } from './runner';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const RUNNER_PATH = join(__dirname, 'runner.ts');
const DEFAULT_RUNS_DIR = join(__dirname, 'runs');

// ---- constants ----

// Phase 2 Indic fan-out — matches the per-lang shard set under data/translations/{slug}/.
export const INDIC_LANGS = ['as', 'bn', 'gu', 'hi', 'kn', 'ml', 'mr', 'or', 'pa', 'ta', 'te'];

const DEFAULT_CONCURRENCY = 3;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BACKOFF_BASE_MS = 5_000;

// ---- types ----

export interface DispatchOpts {
  text: string;
  langs: string[];
  concurrency: number;
  maxAttempts: number;
  backoffBaseMs: number;
  dryRun: boolean;
  runsDir: string;
  dbPath?: string;
  limit?: number;
  /** Injectable for tests — defaults to spawning runner.ts. */
  runChunk?: (lang: string, attempt: number) => Promise<RunSummary>;
  /** Injectable for tests — defaults to setTimeout sleep. */
  sleep?: (ms: number) => Promise<void>;
}

export interface ManifestRow {
  type: 'chunk';
  run_id: string;
  ts: string; // ISO timestamp when the chunk finished
  text: string;
  lang: string;
  status: 'ok' | 'failed';
  attempts: number;
  found: number; // verses lacking a translation at first attempt
  processed: number;
  published: number;
  draft: number;
  skipped: number;
  failed: number; // verses still failing after the final attempt
  duration_ms: number;
  error: string | null;
}

export interface ManifestSummary {
  type: 'summary';
  run_id: string;
  ts: string;
  text: string;
  status: 'ok' | 'failed';
  langs: number;
  ok: number;
  failed: number;
  duration_ms: number;
  manifest_path: string;
}

// ---- helpers ----

/**
 * Canonical translator label per (text, lang). Pinned here — NOT derived from
 * whatever model happens to be configured at retry time — so every verse of a
 * (text, lang) pair carries an identical provenance label across attempts/runs.
 */
export function translatorLabelFor(_text: string, _lang: string): string {
  return `sohamhamso AI pipeline (${MODEL_DISPLAY})`;
}

/** Errors worth retrying: rate limits, overload, timeouts, transport flakes. */
export function isTransientError(message: string): boolean {
  return /rate.?limit|overloaded|\b(429|5\d\d)\b|timeout|timed.?out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EPIPE|EAI_AGAIN|socket|network|fetch failed/i.test(
    message,
  );
}

export function backoffMs(baseMs: number, attempt: number): number {
  // attempt is 1-based; full backoff after attempt N before attempt N+1
  return baseMs * 2 ** (attempt - 1);
}

export function exitCodeFor(summary: ManifestSummary): number {
  return summary.failed > 0 ? 1 : 0;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

/** Bounded-concurrency pool: runs fn over items with at most `limit` in flight. */
async function runPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---- runner subprocess ----

function buildRunnerArgs(opts: DispatchOpts, lang: string): string[] {
  const args = [
    'bun',
    RUNNER_PATH,
    '--text',
    opts.text,
    '--lang',
    lang,
    '--json',
    '--translator',
    translatorLabelFor(opts.text, lang),
  ];
  if (opts.dryRun) args.push('--dry-run');
  if (opts.dbPath) args.push('--db', opts.dbPath);
  if (opts.limit !== undefined) args.push('--limit', String(opts.limit));
  return args;
}

async function spawnRunner(opts: DispatchOpts, lang: string): Promise<RunSummary> {
  const proc = Bun.spawn(buildRunnerArgs(opts, lang), {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;

  // The runner prints the RunSummary JSON as its final stdout line (--json).
  // A nonzero exit with a parseable summary just means failed > 0 — the
  // retry/manifest logic handles that; only an unparseable run is thrown.
  const lines = stdout.split('\n').filter((l) => l.trim().length > 0);
  const last = lines[lines.length - 1] ?? '';
  try {
    return JSON.parse(last) as RunSummary;
  } catch {
    const tail = stderr.trim().split('\n').slice(-5).join(' | ');
    throw new Error(
      `runner.ts (${opts.text}/${lang}) exit=${exitCode} produced no JSON summary: ${tail || last || '(no output)'}`,
    );
  }
}

// ---- orchestration ----

async function runLang(
  opts: DispatchOpts,
  lang: string,
  runId: string,
  log: (msg: string) => void,
): Promise<ManifestRow> {
  const runChunk = opts.runChunk ?? ((l: string) => spawnRunner(opts, l));
  const sleep = opts.sleep ?? defaultSleep;
  const started = Date.now();

  const row: ManifestRow = {
    type: 'chunk',
    run_id: runId,
    ts: '',
    text: opts.text,
    lang,
    status: 'failed',
    attempts: 0,
    found: 0,
    processed: 0,
    published: 0,
    draft: 0,
    skipped: 0,
    failed: 0,
    duration_ms: 0,
    error: null,
  };

  while (row.attempts < opts.maxAttempts) {
    row.attempts++;
    let transient = false;
    try {
      const res = await runChunk(lang, row.attempts);
      if (row.attempts === 1) row.found = res.found;
      // Accumulate across attempts: a retry only sees the still-missing verses.
      row.processed += res.processed;
      row.published += res.published;
      row.draft += res.draft;
      row.skipped += res.skipped;
      row.failed = res.failed;
      if (res.failed === 0) {
        row.status = 'ok';
        row.error = null;
        break;
      }
      row.error = `${res.failed} verse(s) failed; first: ${res.failures[0]?.error ?? 'unknown'}`;
      transient = res.failures.some((f) => isTransientError(f.error));
    } catch (err) {
      row.failed = Math.max(row.failed, 1);
      row.error = (err as Error).message;
      transient = isTransientError(row.error);
    }
    if (!transient || row.attempts >= opts.maxAttempts) break;
    const wait = backoffMs(opts.backoffBaseMs, row.attempts);
    log(
      `[retry] ${opts.text}/${lang} attempt ${row.attempts} failed (transient); backoff ${wait}ms`,
    );
    await sleep(wait);
  }

  row.ts = new Date().toISOString();
  row.duration_ms = Date.now() - started;
  log(
    `[${row.status}] ${opts.text}/${lang} attempts=${row.attempts} published=${row.published} draft=${row.draft} skipped=${row.skipped} failed=${row.failed} (${row.duration_ms}ms)`,
  );
  return row;
}

export async function dispatch(opts: DispatchOpts): Promise<ManifestSummary> {
  const started = Date.now();
  const stamp = new Date().toISOString().replace(/[:.]/g, '').replace('T', '-').slice(0, 17);
  const runId = `${stamp}-${opts.text}`;
  const manifestPath = join(opts.runsDir, `${runId}.jsonl`);
  mkdirSync(opts.runsDir, { recursive: true });

  // Human-readable progress goes to stderr; stdout is reserved for the final
  // machine-readable JSON summary.
  const log = (msg: string) => console.error(msg);
  log(
    `Dispatch: text=${opts.text} langs=${opts.langs.join(',')} concurrency=${opts.concurrency} max_attempts=${opts.maxAttempts} dry_run=${opts.dryRun}`,
  );
  log(`Manifest: ${manifestPath}`);

  const rows = await runPool(opts.langs, opts.concurrency, async (lang) => {
    const row = await runLang(opts, lang, runId, log);
    // Append as each chunk finishes so an aborted run still leaves evidence.
    appendFileSync(manifestPath, `${JSON.stringify(row)}\n`);
    return row;
  });

  const failed = rows.filter((r) => r.status === 'failed').length;
  const summary: ManifestSummary = {
    type: 'summary',
    run_id: runId,
    ts: new Date().toISOString(),
    text: opts.text,
    status: failed > 0 ? 'failed' : 'ok',
    langs: opts.langs.length,
    ok: rows.length - failed,
    failed,
    duration_ms: Date.now() - started,
    manifest_path: manifestPath,
  };
  appendFileSync(manifestPath, `${JSON.stringify(summary)}\n`);
  return summary;
}

// ---- CLI ----

function parseArgs(argv: string[]): DispatchOpts {
  const opts: DispatchOpts = {
    text: '',
    langs: INDIC_LANGS,
    concurrency: DEFAULT_CONCURRENCY,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    backoffBaseMs: DEFAULT_BACKOFF_BASE_MS,
    dryRun: false,
    runsDir: DEFAULT_RUNS_DIR,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--text' && argv[i + 1]) opts.text = argv[++i];
    else if (a === '--langs' && argv[i + 1])
      opts.langs = argv[++i]
        .split(',')
        .map((l) => l.trim())
        .filter(Boolean);
    else if (a === '--concurrency' && argv[i + 1])
      opts.concurrency = Number.parseInt(argv[++i], 10);
    else if (a === '--max-attempts' && argv[i + 1])
      opts.maxAttempts = Number.parseInt(argv[++i], 10);
    else if (a === '--backoff-ms' && argv[i + 1])
      opts.backoffBaseMs = Number.parseInt(argv[++i], 10);
    else if (a === '--limit' && argv[i + 1]) opts.limit = Number.parseInt(argv[++i], 10);
    else if (a === '--db' && argv[i + 1]) opts.dbPath = argv[++i];
    else if (a === '--runs-dir' && argv[i + 1]) opts.runsDir = argv[++i];
    else if (a === '--dry-run') opts.dryRun = true;
  }
  if (!opts.text) throw new Error('Missing required --text (e.g. --text siva-sutras)');
  if (!Number.isInteger(opts.concurrency) || opts.concurrency < 1)
    throw new Error('--concurrency must be a positive integer');
  if (!Number.isInteger(opts.maxAttempts) || opts.maxAttempts < 1)
    throw new Error('--max-attempts must be a positive integer');
  if (opts.langs.length === 0) throw new Error('--langs resolved to an empty list');
  return opts;
}

if (import.meta.main) {
  dispatch(parseArgs(Bun.argv.slice(2)))
    .then((summary) => {
      console.log(JSON.stringify(summary));
      process.exit(exitCodeFor(summary));
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
