import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type DispatchOpts,
  INDIC_LANGS,
  type ManifestRow,
  type ManifestSummary,
  backoffMs,
  dispatch,
  exitCodeFor,
  isTransientError,
  translatorLabelFor,
} from '../../pipeline/translate/dispatch';
import type { RunSummary } from '../../pipeline/translate/runner';

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

function makeRunsDir(): string {
  const dir = mkdtempSync(resolve(tmpdir(), 'sohamhamso-dispatch-'));
  tempDirs.push(dir);
  return dir;
}

function okSummary(lang: string, over: Partial<RunSummary> = {}): RunSummary {
  return {
    text: 'siva-sutras',
    lang,
    dry_run: false,
    found: 5,
    processed: 5,
    published: 4,
    draft: 1,
    skipped: 0,
    failed: 0,
    failures: [],
    ...over,
  };
}

function baseOpts(runsDir: string, over: Partial<DispatchOpts> = {}): DispatchOpts {
  return {
    text: 'siva-sutras',
    langs: ['hi', 'ta', 'te'],
    concurrency: 2,
    maxAttempts: 3,
    backoffBaseMs: 100,
    dryRun: false,
    runsDir,
    sleep: async () => {},
    ...over,
  };
}

function readManifest(summary: ManifestSummary): Array<ManifestRow | ManifestSummary> {
  return readFileSync(summary.manifest_path, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
}

describe('dispatch manifest', () => {
  it('writes one chunk row per lang plus a summary row, with the expected schema', async () => {
    const runsDir = makeRunsDir();
    const summary = await dispatch(
      baseOpts(runsDir, { runChunk: async (lang) => okSummary(lang) }),
    );

    expect(summary.status).toBe('ok');
    expect(summary.langs).toBe(3);
    expect(summary.ok).toBe(3);
    expect(summary.failed).toBe(0);
    expect(exitCodeFor(summary)).toBe(0);
    expect(readdirSync(runsDir)).toEqual([`${summary.run_id}.jsonl`]);
    expect(summary.manifest_path).toBe(join(runsDir, `${summary.run_id}.jsonl`));

    const rows = readManifest(summary);
    expect(rows).toHaveLength(4); // 3 chunks + 1 summary

    const chunks = rows.filter((r) => r.type === 'chunk') as ManifestRow[];
    expect(chunks.map((c) => c.lang).sort()).toEqual(['hi', 'ta', 'te']);
    for (const c of chunks) {
      expect(c.run_id).toBe(summary.run_id);
      expect(c.text).toBe('siva-sutras');
      expect(c.status).toBe('ok');
      expect(c.attempts).toBe(1);
      expect(c.found).toBe(5);
      expect(c.processed).toBe(5);
      expect(c.published).toBe(4);
      expect(c.draft).toBe(1);
      expect(c.skipped).toBe(0);
      expect(c.failed).toBe(0);
      expect(c.error).toBeNull();
      expect(typeof c.duration_ms).toBe('number');
      expect(Date.parse(c.ts)).not.toBeNaN();
    }

    const last = rows[rows.length - 1] as ManifestSummary;
    expect(last.type).toBe('summary');
    expect(last.run_id).toBe(summary.run_id);
    expect(last.status).toBe('ok');
  });

  it('marks a lang failed and exits nonzero when a chunk keeps failing', async () => {
    const runsDir = makeRunsDir();
    const summary = await dispatch(
      baseOpts(runsDir, {
        runChunk: async (lang) => {
          if (lang === 'ta') {
            // non-transient: a parse failure should NOT be retried
            return okSummary(lang, {
              processed: 4,
              published: 4,
              draft: 0,
              failed: 1,
              failures: [
                { verse_id: 42, ref: 'siva-sutras 1.5', error: 'Failed to parse translation JSON' },
              ],
            });
          }
          return okSummary(lang);
        },
      }),
    );

    expect(summary.status).toBe('failed');
    expect(summary.ok).toBe(2);
    expect(summary.failed).toBe(1);
    expect(exitCodeFor(summary)).toBe(1);

    const chunks = readManifest(summary).filter((r) => r.type === 'chunk') as ManifestRow[];
    const ta = chunks.find((c) => c.lang === 'ta');
    expect(ta?.status).toBe('failed');
    expect(ta?.attempts).toBe(1); // non-transient => no retry
    expect(ta?.failed).toBe(1);
    expect(ta?.error).toContain('Failed to parse translation JSON');
  });

  it('retries transient failures with exponential backoff and accumulates counts', async () => {
    const runsDir = makeRunsDir();
    const sleeps: number[] = [];
    const summary = await dispatch(
      baseOpts(runsDir, {
        langs: ['hi'],
        backoffBaseMs: 100,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
        runChunk: async (lang, attempt) => {
          if (attempt < 3) {
            // retry only re-attempts the still-missing verses
            return okSummary(lang, {
              found: attempt === 1 ? 5 : 2,
              processed: 3,
              published: 3,
              draft: 0,
              failed: 2,
              failures: [
                { verse_id: 7, ref: 'siva-sutras 1.7', error: 'rate_limit_error 429' },
                { verse_id: 8, ref: 'siva-sutras 1.8', error: 'Overloaded (529)' },
              ],
            });
          }
          return okSummary(lang, { found: 2, processed: 2, published: 2, draft: 0 });
        },
      }),
    );

    expect(summary.status).toBe('ok');
    expect(sleeps).toEqual([100, 200]); // base * 2^(attempt-1)

    const [row] = readManifest(summary).filter((r) => r.type === 'chunk') as ManifestRow[];
    expect(row.attempts).toBe(3);
    expect(row.status).toBe('ok');
    expect(row.found).toBe(5); // pinned to first attempt
    expect(row.published).toBe(8); // 3 + 3 + 2 across attempts
    expect(row.failed).toBe(0);
    expect(row.error).toBeNull();
  });

  it('gives up after maxAttempts on persistent transient errors', async () => {
    const runsDir = makeRunsDir();
    let calls = 0;
    const summary = await dispatch(
      baseOpts(runsDir, {
        langs: ['hi'],
        maxAttempts: 2,
        runChunk: async () => {
          calls++;
          throw new Error('fetch failed: ECONNRESET');
        },
      }),
    );

    expect(calls).toBe(2);
    expect(summary.status).toBe('failed');
    expect(exitCodeFor(summary)).toBe(1);
    const [row] = readManifest(summary).filter((r) => r.type === 'chunk') as ManifestRow[];
    expect(row.attempts).toBe(2);
    expect(row.status).toBe('failed');
    expect(row.error).toContain('ECONNRESET');
  });

  it('bounds concurrency to the configured limit', async () => {
    const runsDir = makeRunsDir();
    let inFlight = 0;
    let maxInFlight = 0;
    const summary = await dispatch(
      baseOpts(runsDir, {
        langs: [...INDIC_LANGS],
        concurrency: 3,
        runChunk: async (lang) => {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((res) => setTimeout(res, 5));
          inFlight--;
          return okSummary(lang);
        },
      }),
    );

    expect(summary.langs).toBe(INDIC_LANGS.length);
    expect(summary.status).toBe('ok');
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBeGreaterThan(1);
  });
});

describe('dispatch helpers', () => {
  it('classifies transient vs permanent errors', () => {
    expect(isTransientError('rate_limit_error: 429')).toBe(true);
    expect(isTransientError('Overloaded (529)')).toBe(true);
    expect(isTransientError('upstream returned 503')).toBe(true);
    expect(isTransientError('fetch failed')).toBe(true);
    expect(isTransientError('request timed out')).toBe(true);
    expect(isTransientError('Failed to parse judge JSON: Unexpected token')).toBe(false);
    expect(isTransientError('Missing required --lang')).toBe(false);
  });

  it('doubles backoff per attempt', () => {
    expect(backoffMs(100, 1)).toBe(100);
    expect(backoffMs(100, 2)).toBe(200);
    expect(backoffMs(100, 3)).toBe(400);
  });

  it('pins a stable translator label per (text, lang)', () => {
    const a = translatorLabelFor('siva-sutras', 'hi');
    expect(a).toBe(translatorLabelFor('siva-sutras', 'hi'));
    expect(a).toContain('sohamhamso');
  });
});
