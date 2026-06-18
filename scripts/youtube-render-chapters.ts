#!/usr/bin/env bun
/**
 * scripts/youtube-render-chapters.ts
 *
 * Chapter-format render orchestrator (clone of youtube-render.ts shape).
 * Picks `pending` chapter rows OR (`failed` AND retry_count<3 AND
 * last_error_phase != 'upload') up to --limit (default 2 — chapter renders
 * run 30–90 min each), and renders each via renderChapterOne:
 *   per-verse TTS → Remotion 'Chapter' → encode → QA → R2 mp4+sidecar → DB.
 *
 * Queue/failure correctness (eng decisions #20/#21):
 *   - upload-phase failures are EXCLUDED: a failed YouTube upload must not
 *     trigger a 90-min re-render (the R2 mp4 is fine).
 *   - md5-mismatch rows are superseded+skipped inside the engine, never
 *     retried.
 *   - EXIT NON-ZERO when any row reaches MAX_RETRY this run, so the
 *     workflow's if:failure() issue step actually fires. The failure log
 *     names the verse (via last_error) and prints the local repro command.
 *
 * Special modes:
 *   --video-id=N [--keep-workdir]   render exactly one row (failure repro)
 *   --audio-only --video-id=N --lang=hi --out=track.m4a [--sidecar=p]
 *       emit ONE aligned narration track for the multi-audio test
 *       (no DB/R2 mutation; exit 3 if not a chapter row / sidecar missing)
 *
 * Conforms to CLI-CONVENTIONS: --help/--json/--dry-run/--limit/--text-slug/
 * --lang/--force.
 */
import { randomUUID } from 'node:crypto';
import {
  ChapterAudioOnlyError,
  renderChapterAudioOnly,
  renderChapterOne,
} from '../pipeline/youtube/chapter-render-engine';
import { UsageError, parseCommonArgs } from '../pipeline/youtube/cli';
import { loadYoutubeConfig } from '../pipeline/youtube/config';
import { log, logError, scrubError } from '../pipeline/youtube/log';
import {
  type VideoRow,
  getVideosDb,
  listByStatus,
  recordPipelineRun,
  updateVideoStatus,
} from '../src/lib/videos-db';

const STAGE = 'render';
export const DEFAULT_LIMIT = 2;
export const MAX_RETRY = 3;

const USAGE = `youtube-render-chapters — chapter-format render orchestrator (TTS → Remotion → QA → R2)

Usage:
  bun scripts/youtube-render-chapters.ts [--limit=N] [--dry-run] [--json]
                                         [--text-slug=SLUG] [--lang=CODE]
                                         [--video-id=N] [--keep-workdir]
  bun scripts/youtube-render-chapters.ts --audio-only --video-id=N --lang=CODE
                                         --out=track.m4a [--sidecar=meta.json]

Flags:
  --help            Show this help and exit 0
  --json            Machine-readable summary on stdout
  --dry-run         Plan only — pick rows, render nothing
  --limit=N         Max rows this run (default ${DEFAULT_LIMIT}; chapter renders are long)
  --text-slug=SLUG  Restrict to one text
  --lang=CODE       Restrict to one lang (with --audio-only: the TARGET track lang)
  --video-id=N      Target one row by id (failure repro / staged-live)
  --keep-workdir    Skip workdir cleanup + print its path (debugging)
  --audio-only      Emit one aligned narration track; NO DB/R2 mutation
  --out=PATH        (--audio-only) output .m4a/.mp3 path
  --sidecar=PATH    (--audio-only) local .meta.json override (else R2)
  --force           Re-process even if determinism matches (reserved)

Env:
  MOCK_ALL=true     Zero-secret canned render path

Exit codes:
  0 ok    1 runtime failure OR a row exhausted MAX_RETRY    2 usage error    3 gate (--audio-only row/sidecar)
`;

/** True when a failed row may re-enter the render queue. */
export function isRetryableFailedChapter(
  row: Pick<VideoRow, 'retry_count' | 'last_error_phase'>,
): boolean {
  // Upload-phase failures are an UPLOADER problem — the rendered R2 mp4 is
  // fine; re-rendering for 90 min would burn the retry budget for nothing.
  if (row.last_error_phase === 'upload') return false;
  return (row.retry_count ?? 0) < MAX_RETRY;
}

/** True once a row's retry budget is exhausted (drives the exit code). */
export function reachedMaxRetry(retryCount: number | null | undefined): boolean {
  return (retryCount ?? 0) >= MAX_RETRY;
}

/** Batch exit code: non-zero when any row exhausted MAX_RETRY this run. */
export function exitCodeForBatch(exhaustedCount: number): number {
  return exhaustedCount > 0 ? 1 : 0;
}

/**
 * Build the work queue: pending chapter rows first, then failed-with-
 * retry-budget (excluding upload-phase failures). format='chapter' on BOTH
 * picks; rows are also post-filtered on row.format as defense-in-depth.
 */
export function pickChapterQueue(
  db: ReturnType<typeof getVideosDb>,
  limit: number,
  textSlug?: string,
  lang?: string,
): VideoRow[] {
  const filter = { textId: textSlug, lang, format: 'chapter' as const };
  const onlyChapters = (rows: VideoRow[]) => rows.filter((r) => r.format === 'chapter');

  const pending = onlyChapters(listByStatus(db, 'pending', limit, filter));
  let queue = pending;
  if (queue.length < limit) {
    const failed = onlyChapters(listByStatus(db, 'failed', limit, filter)).filter(
      isRetryableFailedChapter,
    );
    queue = queue.concat(failed).slice(0, limit);
  }
  return queue.slice(0, limit);
}

/** The exact local repro command printed into failure logs/issues. */
export function reproCommand(videoId: number): string {
  return `bun scripts/youtube-render-chapters.ts --video-id=${videoId} --keep-workdir`;
}

async function runAudioOnly(args: ReturnType<typeof parseCommonArgs>): Promise<void> {
  const videoId = Number.parseInt(args.extra['video-id'] ?? '', 10);
  const out = args.extra.out;
  if (!Number.isFinite(videoId) || !out || !args.lang) {
    console.error('--audio-only requires --video-id=N, --lang=CODE and --out=PATH');
    process.exit(2);
  }
  const db = getVideosDb();
  try {
    const res = await renderChapterAudioOnly(db, {
      videoId,
      lang: args.lang,
      outPath: out,
      sidecarPath: args.extra.sidecar || undefined,
    });
    if (args.json) console.log(JSON.stringify(res, null, 2));
    else log(STAGE, 'audio-only complete', { ...res } as unknown as Record<string, unknown>);
  } catch (e) {
    if (e instanceof ChapterAudioOnlyError) {
      console.error(`[youtube:${STAGE}] ${e.message}`);
      process.exit(3);
    }
    throw e;
  }
}

async function main(): Promise<void> {
  let args: ReturnType<typeof parseCommonArgs>;
  try {
    args = parseCommonArgs(process.argv.slice(2), [
      'video-id',
      'keep-workdir',
      'audio-only',
      'out',
      'sidecar',
    ]);
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

  if ('audio-only' in args.extra) {
    await runAudioOnly(args);
    return;
  }

  const limit = args.limit ?? DEFAULT_LIMIT;
  const cfg = loadYoutubeConfig();
  const db = getVideosDb();
  const runId = randomUUID();
  const keepWorkDir = 'keep-workdir' in args.extra;

  let queue: VideoRow[];
  if (args.extra['video-id'] !== undefined) {
    const id = Number.parseInt(args.extra['video-id'], 10);
    if (!Number.isFinite(id)) {
      console.error(`bad --video-id: ${args.extra['video-id']}`);
      process.exit(2);
    }
    const row = db.query<VideoRow, [number]>('SELECT * FROM videos WHERE id = ? LIMIT 1').get(id);
    if (!row) {
      console.error(`[youtube:${STAGE}] video id ${id} not found`);
      process.exit(3);
    }
    if (row.format !== 'chapter') {
      console.error(
        `[youtube:${STAGE}] video ${id} is format='${row.format}' — use youtube-render.ts for shorts`,
      );
      process.exit(3);
    }
    if (row.status === 'superseded' && !args.force) {
      console.error(
        `[youtube:${STAGE}] video ${id} is superseded — re-backfill, or pass --force to render anyway`,
      );
      process.exit(3);
    }
    queue = [row];
  } else {
    queue = pickChapterQueue(db, limit, args.textSlug, args.lang);
  }

  const pendingN = queue.filter((r) => r.status === 'pending').length;
  log(STAGE, `picked ${queue.length} chapter rows`, {
    pending: pendingN,
    'failed-retry': queue.length - pendingN,
  });

  const results: Array<{ id: number; status: string; error?: string }> = [];
  const exhausted: Array<{ id: number; lastError: string | null }> = [];

  for (const video of queue) {
    if (args.dryRun) {
      results.push({ id: video.id, status: 'would-render' });
      continue;
    }

    const started = Date.now();
    // E4: stamp the lease + flip to rendering before doing work (the sweep
    // gives chapter rows a 4h TTL — renders routinely outlive the shorts 1h).
    updateVideoStatus(db, video.id, 'rendering', {
      rendering_lease_at: new Date().toISOString(),
    });

    try {
      const res = await renderChapterOne(db, video, { cfg, keepWorkDir });
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
      // renderChapterOne is defensive, but guard anyway.
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

    // Did this run exhaust the row's retry budget? (drives the exit code +
    // the failure-issue content: verse ref via last_error + repro command)
    const after = db
      .query<Pick<VideoRow, 'status' | 'retry_count' | 'last_error'>, [number]>(
        'SELECT status, retry_count, last_error FROM videos WHERE id = ? LIMIT 1',
      )
      .get(video.id);
    if (after && after.status === 'failed' && reachedMaxRetry(after.retry_count)) {
      exhausted.push({ id: video.id, lastError: after.last_error });
      console.error(
        `[youtube:${STAGE}] MAX_RETRY (${MAX_RETRY}) reached for video ${video.id} ` +
          `(${video.text_id} ch${video.chapter} ${video.lang}): ${after.last_error ?? 'unknown error'}\n` +
          `[youtube:${STAGE}]   repro locally: ${reproCommand(video.id)}\n` +
          `[youtube:${STAGE}]   reset retries: bun scripts/youtube-revisit.ts --video-id=${video.id} --reset-retries`,
      );
    }
  }

  const approved = results.filter((r) => r.status === 'approved').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;

  const summary = {
    runId,
    picked: queue.length,
    approved,
    failed,
    skipped, // md5-mismatch supersedes awaiting backfill dispatch
    exhausted: exhausted.map((x) => x.id),
    dryRun: args.dryRun,
    results,
  };
  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    log(STAGE, args.dryRun ? 'dry-run complete' : 'chapter render batch complete', {
      picked: queue.length,
      approved,
      failed,
      skipped,
      exhausted: exhausted.length,
    });
    if (skipped > 0) {
      log(STAGE, 'superseded awaiting backfill', {
        count: skipped,
        next: 'dispatch youtube-backfill-chapters',
      });
    }
  }

  // Per-row failures within budget exit 0 (they retry next fire). A row
  // EXHAUSTING its budget exits 1 so the workflow's if:failure() GH-issue
  // step fires (silent-failure fix, eng decision #20).
  process.exit(exitCodeForBatch(exhausted.length));
}

if (import.meta.main) {
  main().catch((e) => {
    logError(STAGE, e);
    process.exit(1);
  });
}
