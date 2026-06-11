#!/usr/bin/env bun
/**
 * scripts/youtube-render.ts
 *
 * Cron A entry. Picks `pending` rows OR (`failed` AND retry_count<3), up to
 * --limit (default 50), and renders each via render-engine.renderOne:
 *   TTS → Remotion → QA → R2 → DB (rendered→approved on QA pass).
 *
 * Sets rendering_lease_at when a row enters rendering (E4 crash recovery).
 * Records a pipeline_runs row per item. Opens no issues — the workflow's
 * if:failure() step handles that (turso-backup pattern).
 *
 * Conforms to CLI-CONVENTIONS: --help/--json/--dry-run/--limit/--text-slug/--lang/--force.
 */
import { randomUUID } from 'node:crypto';
import { UsageError, parseCommonArgs } from '../pipeline/youtube/cli';
import { loadYoutubeConfig } from '../pipeline/youtube/config';
import { log, logError, scrubError } from '../pipeline/youtube/log';
import { renderOne } from '../pipeline/youtube/render-engine';
import {
  type VideoRow,
  getVideosDb,
  listByStatus,
  recordPipelineRun,
  updateVideoStatus,
} from '../src/lib/videos-db';

const STAGE = 'render';
const DEFAULT_LIMIT = 50;
const MAX_RETRY = 3;

const USAGE = `youtube-render — Cron A render orchestrator (TTS → Remotion → QA → R2)

Usage:
  bun scripts/youtube-render.ts [--limit=N] [--dry-run] [--json]
                                [--text-slug=SLUG] [--lang=CODE] [--force]

Flags:
  --help            Show this help and exit 0
  --json            Machine-readable summary on stdout
  --dry-run         Plan only — pick rows, render nothing
  --limit=N         Max rows this run (default ${DEFAULT_LIMIT})
  --text-slug=SLUG  Restrict to one text
  --lang=CODE       Restrict to one lang
  --force           Re-process even if determinism matches (reserved)

Env:
  MOCK_ALL=true     Zero-secret canned render path

Exit codes:
  0 ok    1 runtime failure    2 usage error
`;

/** Build the work queue: pending first, then failed-with-retry-budget. */
function pickQueue(
  db: ReturnType<typeof getVideosDb>,
  limit: number,
  textSlug?: string,
  lang?: string,
): VideoRow[] {
  // Push text/lang into SQL (see listByStatus) so the filter reaches matching
  // rows beyond the first `limit` of the global pending set.
  const filter = { textId: textSlug, lang };

  const pending = listByStatus(db, 'pending', limit, filter);
  let queue = pending;
  if (queue.length < limit) {
    const failed = listByStatus(db, 'failed', limit, filter).filter(
      (r) => (r.retry_count ?? 0) < MAX_RETRY,
    );
    queue = queue.concat(failed).slice(0, limit);
  }
  return queue.slice(0, limit);
}

async function main(): Promise<void> {
  let args: ReturnType<typeof parseCommonArgs>;
  try {
    args = parseCommonArgs(process.argv.slice(2));
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(e.message);
      process.exit(2);
    }
    throw e;
  }
  if (args.help) {
    console.log(USAGE);
    return;
  }

  const limit = args.limit ?? DEFAULT_LIMIT;
  const cfg = loadYoutubeConfig();
  const db = getVideosDb();
  const runId = randomUUID();

  const queue = pickQueue(db, limit, args.textSlug, args.lang);
  const pendingN = queue.filter((r) => r.status === 'pending').length;
  const failedN = queue.length - pendingN;
  log(STAGE, `picked ${queue.length} rows`, { pending: pendingN, 'failed-retry': failedN });

  const results: Array<{ id: number; status: string; error?: string }> = [];

  for (const video of queue) {
    if (args.dryRun) {
      results.push({ id: video.id, status: 'would-render' });
      continue;
    }

    const started = Date.now();
    // E4: stamp the lease + flip to rendering before doing work.
    updateVideoStatus(db, video.id, 'rendering', {
      rendering_lease_at: new Date().toISOString(),
    });

    try {
      const res = await renderOne(db, video, { cfg });
      results.push({ id: video.id, status: res.status, error: res.error });
      recordPipelineRun(db, {
        run_id: runId,
        video_id: video.id,
        phase: 'render',
        status: res.status === 'failed' ? 'err' : 'ok',
        duration_ms: Date.now() - started,
        r2_bytes_written: res.bytes ?? 0,
        error_msg: res.error ? scrubError(res.error) : null,
        finished_at: new Date().toISOString(),
      });
    } catch (e) {
      // renderOne is defensive, but guard anyway.
      const msg = scrubError(e);
      updateVideoStatus(db, video.id, 'failed', {
        last_error: msg,
        last_error_phase: 'render',
        retry_count: (video.retry_count ?? 0) + 1,
      });
      results.push({ id: video.id, status: 'failed', error: msg });
      recordPipelineRun(db, {
        run_id: runId,
        video_id: video.id,
        phase: 'render',
        status: 'err',
        duration_ms: Date.now() - started,
        error_msg: msg,
        finished_at: new Date().toISOString(),
      });
    }
  }

  const approved = results.filter((r) => r.status === 'approved').length;
  const failed = results.filter((r) => r.status === 'failed').length;

  const summary = { runId, picked: queue.length, approved, failed, dryRun: args.dryRun, results };
  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    log(STAGE, args.dryRun ? 'dry-run complete' : 'render batch complete', {
      picked: queue.length,
      approved,
      failed,
    });
  }

  // A batch with any per-item failure is still exit 0 (per-row failures are
  // expected + retried). Only an unhandled top-level throw is exit 1.
}

main().catch((e) => {
  logError(STAGE, e);
  process.exit(1);
});
