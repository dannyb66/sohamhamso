#!/usr/bin/env bun
/**
 * scripts/youtube-upload.ts
 *
 * Cron B entry. Per fire (single channel, no matrix):
 *   1. Quota pre-check: skip if today's units_spent > 8000.
 *   2. Pull oldest `approved` rows with youtube_video_id IS NULL (up to --limit).
 *   3. R2 → /tmp via `aws s3 cp` (MOCK_ALL: synthesize a local file).
 *   4. buildUploadMetadata → youtube.videos.insert (googleapis, dynamic import;
 *      MOCK_ALL → fake video id).
 *   5. Post-upload sha256 integrity check vs output_file_sha256.
 *   6. updateVideoStatus uploaded; addQuotaUnits(~100, 1).
 *   7. On 403 quotaExceeded → set exhausted + exit 0.
 *
 * Conforms to CLI-CONVENTIONS: --help/--json/--dry-run/--limit.
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UsageError, parseCommonArgs, utcDate } from '../pipeline/youtube/cli';
import { loadYoutubeConfig } from '../pipeline/youtube/config';
import { log, logError, scrubError } from '../pipeline/youtube/log';
import { getR2Creds, getYoutubeOAuth } from '../pipeline/youtube/secrets';
import { buildUploadMetadata } from '../pipeline/youtube/upload-metadata';
import { getDb } from '../src/lib/db';
import {
  type VideoRow,
  addQuotaUnits,
  getQuotaToday,
  getVideosDb,
  listByStatus,
  recordPipelineRun,
  updateVideoStatus,
} from '../src/lib/videos-db';

const STAGE = 'upload';
const DEFAULT_LIMIT = 6; // Cron B ~6/cycle (stagger anti-spam)
const QUOTA_CEILING = 8000;
const UNITS_PER_UPLOAD = 100; // post-Dec-2025 videos.insert cost
const CANONICAL_BASE = 'https://sohamhamso.org';

const USAGE = `youtube-upload — Cron B uploader (R2 → YouTube, unlisted)

Usage:
  bun scripts/youtube-upload.ts [--limit=N] [--dry-run] [--json]

Flags:
  --help        Show this help and exit 0
  --json        Machine-readable summary on stdout
  --dry-run     Plan only — pull rows, upload nothing
  --limit=N     Max uploads this run (default ${DEFAULT_LIMIT})

Env:
  MOCK_ALL=true Fake video ids, local file instead of R2 download

Exit codes:
  0 ok (incl. expected quotaExceeded)   1 runtime failure   2 usage error
`;

function isMockAll(): boolean {
  return process.env.MOCK_ALL === 'true';
}

/** Pull oldest approved rows awaiting upload. */
function pickApproved(db: ReturnType<typeof getVideosDb>, limit: number): VideoRow[] {
  return listByStatus(db, 'approved', limit * 4)
    .filter((r) => !r.youtube_video_id)
    .slice(0, limit);
}

/** sha256 hex of a file. */
function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Download an R2 object to a local path (`aws s3 cp`). MOCK_ALL → no-op stub. */
async function downloadR2(key: string, localPath: string): Promise<void> {
  if (isMockAll()) {
    // No real object; write a small placeholder so sha/upload paths run.
    const { writeFileSync } = await import('node:fs');
    writeFileSync(localPath, Buffer.alloc(120_000, 1));
    return;
  }
  const r2 = getR2Creds();
  const proc = Bun.spawn(
    ['aws', 's3', 'cp', `s3://${r2.bucket}/${key}`, localPath, '--endpoint-url', r2.endpoint],
    {
      env: {
        ...process.env,
        AWS_ACCESS_KEY_ID: r2.accessKeyId,
        AWS_SECRET_ACCESS_KEY: r2.secretAccessKey,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const code = await proc.exited;
  if (code !== 0) {
    const err = await new Response(proc.stderr).text();
    throw new Error(`aws s3 cp (download) failed (${code}): ${scrubError(err)}`);
  }
}

/** Resolve title/translation/lang context for a video from the corpus. */
function resolveMeta(video: VideoRow): {
  textTitle: string;
  translation: string;
  canonicalUrl: string;
} {
  const corpus = getDb();
  const text = corpus
    .query<{ title_iast: string | null; title_en: string; slug: string }, [string]>(
      'SELECT title_iast, title_en, slug FROM texts WHERE id = ? LIMIT 1',
    )
    .get(video.text_id);
  const tr = corpus
    .query<{ translation_text: string }, [number]>(
      'SELECT translation_text FROM translations WHERE id = ? LIMIT 1',
    )
    .get(video.translation_row_id);
  const slug = text?.slug ?? video.text_id;
  return {
    textTitle: text?.title_iast || text?.title_en || video.text_id,
    translation: tr?.translation_text ?? '',
    canonicalUrl: `${CANONICAL_BASE}/${slug}/${video.chapter}/${video.verse_num}`,
  };
}

/** True if an error looks like a 403 quotaExceeded. */
function isQuotaExceeded(e: unknown): boolean {
  const s = String(e instanceof Error ? e.message : e);
  return /quotaExceeded|quota exceeded|403/i.test(s);
}

/**
 * Insert a video via googleapis (dynamic import). MOCK_ALL → fake id.
 * Returns the youtube video id.
 */
async function youtubeInsert(
  meta: ReturnType<typeof buildUploadMetadata>,
  filePath: string,
): Promise<string> {
  if (isMockAll()) {
    return `mock-${createHash('md5').update(meta.snippet.title).digest('hex').slice(0, 11)}`;
  }
  const oauth = getYoutubeOAuth();
  const mod = await import('googleapis' as string).catch((e) => {
    throw new Error(`googleapis not installed: ${scrubError(e)}`);
  });
  // biome-ignore lint/suspicious/noExplicitAny: dynamic import shape (dep installed later)
  const { google } = mod as any;
  const oauth2 = new google.auth.OAuth2(oauth.clientId, oauth.clientSecret);
  oauth2.setCredentials({ refresh_token: oauth.refreshToken });
  const youtube = google.youtube({ version: 'v3', auth: oauth2 });
  const { createReadStream } = await import('node:fs');
  const res = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: { snippet: meta.snippet, status: meta.status },
    media: { body: createReadStream(filePath) },
  });
  const id = res?.data?.id;
  if (!id) throw new Error('youtube.videos.insert returned no id');
  return id;
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
  const channel = cfg.defaults.channel_handle;
  const today = utcDate();
  const db = getVideosDb();
  const runId = randomUUID();

  // 1. Quota pre-check.
  const quota = getQuotaToday(db, channel, today);
  if (quota && quota.units_spent > QUOTA_CEILING) {
    log(STAGE, 'quota ceiling reached — skipping', { units: quota.units_spent });
    if (args.json) console.log(JSON.stringify({ skipped: 'quota', units: quota.units_spent }));
    return; // exit 0
  }

  const queue = pickApproved(db, limit);
  log(STAGE, `picked ${queue.length} approved rows`);

  const results: Array<{ id: number; status: string; youtubeId?: string; error?: string }> = [];

  for (const video of queue) {
    if (args.dryRun) {
      results.push({ id: video.id, status: 'would-upload' });
      continue;
    }
    const started = Date.now();
    updateVideoStatus(db, video.id, 'uploading', {
      uploading_lease_at: new Date().toISOString(),
    });

    const localPath = join(tmpdir(), `upload-${video.id}.mp4`);
    try {
      if (!video.r2_key) throw new Error('row has no r2_key');
      await downloadR2(video.r2_key, localPath);

      // Post-download integrity (skip strict check in MOCK_ALL placeholder).
      if (!isMockAll() && video.output_file_sha256) {
        const got = sha256File(localPath);
        if (got !== video.output_file_sha256) {
          throw new Error(`sha256 mismatch: ${got} != ${video.output_file_sha256}`);
        }
      }

      const m = resolveMeta(video);
      const meta = buildUploadMetadata({
        textTitle: m.textTitle,
        chapter: video.chapter,
        verseNum: video.verse_num,
        lang: video.lang,
        translation: m.translation,
        canonicalUrl: m.canonicalUrl,
      });

      const youtubeId = await youtubeInsert(meta, localPath);
      const url = `https://www.youtube.com/watch?v=${youtubeId}`;

      updateVideoStatus(db, video.id, 'uploaded', {
        youtube_video_id: youtubeId,
        youtube_url: url,
        visibility: 'unlisted',
        uploaded_at: new Date().toISOString(),
      });
      addQuotaUnits(db, channel, today, UNITS_PER_UPLOAD, 1);
      recordPipelineRun(db, {
        run_id: runId,
        video_id: video.id,
        phase: 'upload',
        status: 'ok',
        duration_ms: Date.now() - started,
        youtube_api_units: UNITS_PER_UPLOAD,
        finished_at: new Date().toISOString(),
      });
      results.push({ id: video.id, status: 'uploaded', youtubeId });
      log(STAGE, 'uploaded', { video: video.id, youtube: youtubeId });
    } catch (e) {
      // 403 quotaExceeded is expected — set exhausted + exit 0.
      if (isQuotaExceeded(e)) {
        addQuotaUnits(db, channel, today, 0, 0);
        const q = getQuotaToday(db, channel, today);
        // Flag exhaustion idempotently via a direct flag update.
        db.query(
          'UPDATE youtube_quota SET exhausted = 1 WHERE channel_handle = ? AND utc_date = ?',
        ).run(channel, today);
        // Reset this row back to approved so the next fire retries.
        updateVideoStatus(db, video.id, 'approved', {});
        log(STAGE, 'quotaExceeded — marked exhausted, exiting 0', { units: q?.units_spent ?? 0 });
        if (args.json) console.log(JSON.stringify({ skipped: 'quotaExceeded', results }));
        return; // exit 0
      }

      const msg = scrubError(e);
      updateVideoStatus(db, video.id, 'failed', {
        last_error: msg,
        last_error_phase: 'upload',
        upload_retry_count: (video.upload_retry_count ?? 0) + 1,
      });
      recordPipelineRun(db, {
        run_id: runId,
        video_id: video.id,
        phase: 'upload',
        status: 'err',
        duration_ms: Date.now() - started,
        error_msg: msg,
        finished_at: new Date().toISOString(),
      });
      results.push({ id: video.id, status: 'failed', error: msg });
      log(STAGE, 'upload failed', { video: video.id });
    }
  }

  const uploaded = results.filter((r) => r.status === 'uploaded').length;
  const summary = { runId, picked: queue.length, uploaded, dryRun: args.dryRun, results };
  if (args.json) console.log(JSON.stringify(summary, null, 2));
  else log(STAGE, 'upload batch complete', { picked: queue.length, uploaded });
}

main().catch((e) => {
  logError(STAGE, e);
  process.exit(1);
});
