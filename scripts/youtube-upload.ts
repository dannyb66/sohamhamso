#!/usr/bin/env bun
/**
 * scripts/youtube-upload.ts
 *
 * Cron B entry. Per fire (single channel, no matrix):
 *   1. Quota pre-check: skip if today's units_spent > 8000.
 *   2. Pull oldest `approved` rows with youtube_video_id IS NULL (up to --limit).
 *      Chapter-format rows are HELD until `chapters.uploads_enabled: true`
 *      (measurement-window gate — renders/QA/R2 proceed regardless).
 *   3. R2 → /tmp via `aws s3 cp` (MOCK_ALL: synthesize a local file).
 *      Chapter rows ALSO fetch the `.meta.json` timestamp sidecar — a missing
 *      sidecar fails the row loudly (never upload a chapter without timestamps).
 *   4. buildUploadMetadata / buildChapterUploadMetadata → youtube.videos.insert
 *      (googleapis, dynamic import; MOCK_ALL → fake video id).
 *   5. Post-upload sha256 integrity check vs output_file_sha256.
 *   6. updateVideoStatus uploaded; addQuotaUnits(~100, 1).
 *   7. On 403 quotaExceeded → set exhausted + exit 0.
 *
 * Large-file note (~1 GB chapter videos): googleapis@144 streams media as a
 * multipart upload — the node client dropped resumable-media support years ago
 * (uploadType=resumable is NOT used; see google-api-nodejs-client#1875). A
 * mid-stream network drop therefore aborts the whole request. Mitigation here:
 * chapter inserts retry ONCE on a network-class error with a fresh read
 * stream. Worst case (first request actually completed server-side after the
 * socket dropped) is a duplicate UNLISTED video — operator dedupes in Studio;
 * the DB records only the retry's id.
 *
 * Conforms to CLI-CONVENTIONS: --help/--json/--dry-run/--limit.
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UsageError, parseCommonArgs, utcDate } from '../pipeline/youtube/cli';
import { loadYoutubeConfig } from '../pipeline/youtube/config';
import { chapterMetaKey } from '../pipeline/youtube/filename';
import { log, logError, scrubError } from '../pipeline/youtube/log';
import { getR2Creds, getYoutubeOAuth } from '../pipeline/youtube/secrets';
import {
  type UploadMetadata,
  buildChapterUploadMetadata,
  buildUploadMetadata,
} from '../pipeline/youtube/upload-metadata';
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
const UNITS_PER_UPLOAD = 100; // post-Dec-2025 videos.insert cost (was 1600)
// Account-level daily upload-count cap. This — NOT the API quota — is the real
// ceiling: YouTube throttles a channel to a small rolling-24h count
// (`uploadLimitExceeded`). Research puts an unverified channel at ~10-15/day;
// this channel was observed succeeding ~17/day before the 403. Stop proactively
// just under that so we don't spam dead inserts into the wall. Raise via
// YT_MAX_UPLOADS_PER_DAY once the channel is phone-verified + has clean history.
const MAX_UPLOADS_PER_DAY = Number(process.env.YT_MAX_UPLOADS_PER_DAY) || 12;
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

/** Pull oldest approved candidate rows awaiting upload (pre-hold, pre-limit). */
function pickApprovedCandidates(db: ReturnType<typeof getVideosDb>, limit: number): VideoRow[] {
  return listByStatus(db, 'approved', limit * 4).filter((r) => !r.youtube_video_id);
}

/** Row format ('short' | 'chapter'). Null-tolerant for pre-migration rows. */
function rowFormat(r: VideoRow): 'short' | 'chapter' {
  return r.format === 'chapter' ? 'chapter' : 'short';
}

/** Upload hold for chapter rows — flipped by the operator after the shorts measurement window. */
function chapterUploadsEnabled(cfg: ReturnType<typeof loadYoutubeConfig>): boolean {
  return cfg.chapters.uploads_enabled === true;
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
  iast: string;
  devanagari: string;
} {
  const corpus = getDb();
  const text = corpus
    .query<
      { title_iast: string | null; title_en: string; slug: string; tradition: string },
      [string]
    >('SELECT title_iast, title_en, slug, tradition FROM texts WHERE id = ? LIMIT 1')
    .get(video.text_id);
  const tr = corpus
    .query<{ translation_text: string }, [number]>(
      'SELECT translation_text FROM translations WHERE id = ? LIMIT 1',
    )
    .get(video.translation_row_id);
  // Sanskrit verse (IAST + Devanāgarī) — shared across languages, boosts SEO.
  const verse = corpus
    .query<{ iast: string | null; devanagari: string | null }, [string, number, number]>(
      'SELECT iast, devanagari FROM verses WHERE text_id = ? AND chapter = ? AND verse_num = ? LIMIT 1',
    )
    .get(video.text_id, video.chapter, video.verse_num);
  const slug = text?.slug ?? video.text_id;
  // Site routes are /{tradition}/{text}/{chapter}/{verse} — the tradition
  // segment was missing here (pre-existing bug; the SEO rewrite kept it).
  const tradition = text?.tradition ?? 'trika';
  return {
    textTitle: text?.title_iast || text?.title_en || video.text_id,
    translation: tr?.translation_text ?? '',
    canonicalUrl: `${CANONICAL_BASE}/${tradition}/${slug}/${video.chapter}/${video.verse_num}`,
    iast: verse?.iast ?? '',
    devanagari: verse?.devanagari ?? '',
  };
}

/** Resolve corpus context for a CHAPTER row (verse_num = 0 → use the chapter's first verse). */
function resolveChapterMeta(video: VideoRow): {
  textTitle: string;
  tradition: string;
  textSlug: string;
  summary: string;
  iast: string;
  devanagari: string;
} {
  const corpus = getDb();
  const text = corpus
    .query<
      { title_iast: string | null; title_en: string; slug: string; tradition: string },
      [string]
    >('SELECT title_iast, title_en, slug, tradition FROM texts WHERE id = ? LIMIT 1')
    .get(video.text_id);
  // translation_row_id on chapter rows anchors the chapter's FIRST verse
  // (documented provenance anchor) — its translation front-loads the description.
  const tr = corpus
    .query<{ translation_text: string }, [number]>(
      'SELECT translation_text FROM translations WHERE id = ? LIMIT 1',
    )
    .get(video.translation_row_id);
  const firstVerse = corpus
    .query<{ iast: string | null; devanagari: string | null }, [string, number]>(
      'SELECT iast, devanagari FROM verses WHERE text_id = ? AND chapter = ? ORDER BY verse_num ASC LIMIT 1',
    )
    .get(video.text_id, video.chapter);
  return {
    textTitle: text?.title_iast || text?.title_en || video.text_id,
    tradition: text?.tradition ?? 'trika',
    textSlug: text?.slug ?? video.text_id,
    summary: tr?.translation_text ?? '',
    iast: firstVerse?.iast ?? '',
    devanagari: firstVerse?.devanagari ?? '',
  };
}

/** Timestamp sidecar written next to the chapter MP4 by the chapter render engine. */
interface ChapterSidecar {
  segments: Array<{ verse_num: number; startS: number }>;
  durationS: number;
  verseCount?: number;
  outroStartS?: number;
}

/**
 * R2 key of the chapter timestamp sidecar. Built via `chapterMetaKey` from the
 * row's identity + chapter content md5 (translation_md5) — the same inputs the
 * render engine uses for the atomic mp4+sidecar pair. If the row's actual
 * r2_key disagrees (it is ground truth for the downloaded artifact), prefer
 * deriving from it so timestamps always pair with THIS mp4.
 */
function sidecarKeyFor(video: VideoRow): string {
  const built = chapterMetaKey(
    { text_id: video.text_id, chapter: video.chapter, lang: video.lang },
    video.translation_md5,
  );
  if (video.r2_key?.endsWith('.mp4')) {
    const derived = video.r2_key.replace(/\.mp4$/, '.meta.json');
    if (derived !== built) {
      log(STAGE, 'sidecar key mismatch — using the r2_key-derived pair', {
        video: video.id,
        built,
        derived,
      });
    }
    return derived;
  }
  return built;
}

/**
 * Fetch + parse the chapter sidecar. Throws loudly on a missing/garbled
 * sidecar — a chapter video must NEVER be uploaded without its timestamps.
 */
async function fetchChapterSidecar(video: VideoRow): Promise<ChapterSidecar> {
  if (!video.r2_key) throw new Error('chapter row has no r2_key');
  const key = sidecarKeyFor(video);
  if (isMockAll()) {
    // Canned sidecar so the metadata/timestamp paths run end-to-end.
    return {
      segments: [
        { verse_num: 1, startS: 12 },
        { verse_num: 2, startS: 24 },
      ],
      durationS: 45,
      verseCount: 2,
      outroStartS: 36,
    };
  }
  const localPath = join(tmpdir(), `sidecar-${video.id}.meta.json`);
  try {
    await downloadR2(key, localPath);
  } catch (e) {
    throw new Error(
      `chapter sidecar MISSING in R2 (${key}) — never upload a chapter video without timestamps; ` +
        `re-render the row or investigate the render engine's sidecar write. Cause: ${scrubError(e)}`,
    );
  }
  let sidecar: ChapterSidecar;
  try {
    sidecar = JSON.parse(readFileSync(localPath, 'utf8')) as ChapterSidecar;
  } catch (e) {
    throw new Error(`chapter sidecar unparseable (${key}): ${scrubError(e)}`);
  }
  if (!Array.isArray(sidecar.segments) || sidecar.segments.length === 0) {
    throw new Error(
      `chapter sidecar has no segments (${key}) — refusing to upload without timestamps`,
    );
  }
  return sidecar;
}

/** True if an error looks like a 403 quotaExceeded. */
function isQuotaExceeded(e: unknown): boolean {
  const s = String(e instanceof Error ? e.message : e);
  return /quotaExceeded|quota exceeded|403/i.test(s);
}

/**
 * True if the error means the channel is not verified for >15-minute uploads
 * (YouTube reason `longUploadsNotAllowed`). Operator-actionable + PERMANENT
 * until the channel is verified, so this routes to `failed` (no retry).
 * Checked BEFORE isQuotaExceeded — it arrives as a 403 too, and the generic
 * /403/ match would otherwise misroute it into the quota path.
 *
 * NOTE: `uploadLimitExceeded` is deliberately NOT matched here — that's the
 * *daily upload-count* cap (see isDailyUploadLimit), which RESETS and must be
 * retried, not failed permanently.
 */
function isChannelNotVerified(e: unknown): boolean {
  const s = String(e instanceof Error ? e.message : e);
  return /longUploadsNotAllowed/i.test(s);
}

/**
 * True if the error is YouTube's *daily upload-count* cap (reason
 * `uploadLimitExceeded`, human message "exceeded the number of videos they may
 * upload"). This is a ROLLING 24h limit that RESETS — unlike channel-not-
 * verified it is NOT permanent, so the row goes back to `approved` and retries
 * tomorrow (handled exactly like quotaExceeded). Both the reason code AND the
 * human message are matched: the stringified error often carries only the
 * message, not the machine reason — which is precisely how the first batch of
 * these slipped past the old matcher and got stranded as `failed`.
 */
function isDailyUploadLimit(e: unknown): boolean {
  const s = String(e instanceof Error ? e.message : e);
  return /uploadLimitExceeded|exceeded the number of videos/i.test(s);
}

/** Network-class failures worth one blind retry on a large streamed upload. */
const NETWORK_ERROR_RE =
  /ECONNRESET|ETIMEDOUT|EPIPE|ECONNABORTED|ECONNREFUSED|EAI_AGAIN|socket hang up|premature close|network/i;

/**
 * Insert a video via googleapis (dynamic import). MOCK_ALL → fake id.
 * Returns the youtube video id.
 *
 * `retryOnNetworkError` (chapter rows, ~1 GB streams): googleapis@144 has NO
 * resumable-media support — media streams go up as one multipart request, so
 * a mid-stream network drop aborts the whole upload. We retry exactly once
 * with a FRESH read stream (a half-consumed stream cannot be re-sent). See
 * the header comment for the duplicate-upload tradeoff.
 */
async function youtubeInsert(
  meta: UploadMetadata,
  filePath: string,
  retryOnNetworkError = false,
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

  const attempt = async (): Promise<string> => {
    const res = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: { snippet: meta.snippet, status: meta.status },
      media: { body: createReadStream(filePath) },
    });
    const id = res?.data?.id;
    if (!id) throw new Error('youtube.videos.insert returned no id');
    return id;
  };

  try {
    return await attempt();
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    if (retryOnNetworkError && NETWORK_ERROR_RE.test(msg)) {
      log(STAGE, 'network error mid-upload — retrying once with a fresh stream', {
        error: scrubError(e).slice(0, 160),
      });
      return await attempt();
    }
    throw e;
  }
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

  const cfg = loadYoutubeConfig();
  const channel = cfg.defaults.channel_handle;
  const today = utcDate();
  const db = getVideosDb();
  const runId = randomUUID();

  // 1a. API-quota pre-check (units).
  const quota = getQuotaToday(db, channel, today);
  if (quota && quota.units_spent > QUOTA_CEILING) {
    log(STAGE, 'quota ceiling reached — skipping', { units: quota.units_spent });
    if (args.json) console.log(JSON.stringify({ skipped: 'quota', units: quota.units_spent }));
    return; // exit 0
  }

  // 1b. Account-level daily upload-count cap — the real bottleneck. Skip the
  // whole run once we've hit the cap (or a prior fire flagged `exhausted` after
  // a 403 uploadLimitExceeded), so we don't hammer dead inserts at the wall.
  const uploadsToday = quota?.uploads_count ?? 0;
  if ((quota?.exhausted ?? 0) === 1 || uploadsToday >= MAX_UPLOADS_PER_DAY) {
    log(STAGE, 'daily upload cap reached — skipping', {
      uploads: uploadsToday,
      cap: MAX_UPLOADS_PER_DAY,
      exhausted: quota?.exhausted ?? 0,
    });
    if (args.json) console.log(JSON.stringify({ skipped: 'uploadCap', uploads: uploadsToday }));
    return; // exit 0
  }

  // Clamp this run to the remaining daily budget so a big --limit can't blow
  // past the account cap in a single fire.
  const limit = Math.min(args.limit ?? DEFAULT_LIMIT, MAX_UPLOADS_PER_DAY - uploadsToday);

  // 2. Pick approved rows; HOLD chapter rows until the operator flips
  //    chapters.uploads_enabled after the shorts measurement window closes.
  const candidates = pickApprovedCandidates(db, limit);
  let heldChapters = 0;
  let eligible = candidates;
  if (!chapterUploadsEnabled(cfg)) {
    const held = candidates.filter((r) => rowFormat(r) === 'chapter');
    heldChapters = held.length;
    if (heldChapters > 0) {
      // Exact operator-facing hold line — no status change, rows stay approved.
      log(
        STAGE,
        `${heldChapters} chapter rows held (chapters.uploads_enabled=false — flip in data/youtube-config.yaml and push to main)`,
      );
    }
    eligible = candidates.filter((r) => rowFormat(r) !== 'chapter');
  }
  const queue = eligible.slice(0, limit);
  log(STAGE, `picked ${queue.length} approved rows`, { held: heldChapters });

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

      const format = rowFormat(video);
      let meta: UploadMetadata;
      if (format === 'chapter') {
        // Sidecar first — a missing sidecar fails the row before any quota spend.
        const sidecar = await fetchChapterSidecar(video);
        const cm = resolveChapterMeta(video);
        const lastStart = Math.max(...sidecar.segments.map((s) => s.startS));
        meta = buildChapterUploadMetadata({
          textTitle: cm.textTitle,
          chapter: video.chapter,
          verseCount: sidecar.verseCount ?? sidecar.segments.length,
          lang: video.lang,
          tradition: cm.tradition,
          textSlug: cm.textSlug,
          summary: cm.summary,
          iast: cm.iast,
          devanagari: cm.devanagari,
          segments: sidecar.segments.map((s) => ({ verseNum: s.verse_num, startS: s.startS })),
          // TODO(agent-E): prefer an explicit `outroStartS` in the sidecar; the
          // fallback places the outro line ≥10s after the last verse and ~9s
          // before the end (the outro card length per the design spec).
          outroStartS:
            sidecar.outroStartS ?? Math.max(lastStart + 10, Math.floor(sidecar.durationS) - 9),
        });
      } else {
        const m = resolveMeta(video);
        meta = buildUploadMetadata({
          textTitle: m.textTitle,
          chapter: video.chapter,
          verseNum: video.verse_num,
          lang: video.lang,
          translation: m.translation,
          canonicalUrl: m.canonicalUrl,
          iast: m.iast,
          devanagari: m.devanagari,
        });
      }

      const youtubeId = await youtubeInsert(meta, localPath, format === 'chapter');
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
      // Channel-not-verified (>15-min upload to an unverified channel) is a
      // named, operator-actionable error. NO retry_count bump — retrying
      // cannot succeed until the operator verifies the channel. Checked
      // BEFORE quotaExceeded: these are 403s and would match /403/ otherwise.
      if (isChannelNotVerified(e)) {
        const verifyMsg =
          'channel not verified for >15min uploads — verify at youtube.com/verify, then retry';
        updateVideoStatus(db, video.id, 'failed', {
          last_error: verifyMsg,
          last_error_phase: 'upload',
        });
        recordPipelineRun(db, {
          run_id: runId,
          video_id: video.id,
          phase: 'upload',
          status: 'err',
          duration_ms: Date.now() - started,
          error_msg: verifyMsg,
          finished_at: new Date().toISOString(),
        });
        results.push({ id: video.id, status: 'failed', error: verifyMsg });
        log(STAGE, `upload BLOCKED — ${verifyMsg}`, { video: video.id });
        continue;
      }

      // Account-level DAILY upload-count cap (`uploadLimitExceeded`, rolling
      // 24h — RESETS). NOT permanent like channel-not-verified: behave like
      // quotaExceeded — flag exhausted, put the row back to `approved`, exit 0
      // so a later fire (after the 24h window slides) retries instead of
      // stranding it as `failed`. Checked BEFORE isQuotaExceeded — it's a 403
      // and would otherwise match the generic /403/ in the quota path.
      if (isDailyUploadLimit(e)) {
        addQuotaUnits(db, channel, today, 0, 0);
        db.query(
          'UPDATE youtube_quota SET exhausted = 1 WHERE channel_handle = ? AND utc_date = ?',
        ).run(channel, today);
        updateVideoStatus(db, video.id, 'approved', {});
        log(STAGE, 'uploadLimitExceeded (daily account cap) — marked exhausted, exiting 0', {
          video: video.id,
        });
        if (args.json) console.log(JSON.stringify({ skipped: 'uploadLimitExceeded', results }));
        return; // exit 0
      }

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
  const summary = {
    runId,
    picked: queue.length,
    heldChapters,
    uploaded,
    dryRun: args.dryRun,
    results,
  };
  if (args.json) console.log(JSON.stringify(summary, null, 2));
  else log(STAGE, 'upload batch complete', { picked: queue.length, uploaded, held: heldChapters });
}

main().catch((e) => {
  logError(STAGE, e);
  process.exit(1);
});
