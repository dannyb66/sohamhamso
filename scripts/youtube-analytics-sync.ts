#!/usr/bin/env bun
/**
 * scripts/youtube-analytics-sync.ts
 *
 * Cron E entry (M0.5). Per fire:
 *   1. Open the R2-synced state DB (YOUTUBE_DB_PATH → db/youtube-state.db).
 *   2. Pick `uploaded` rows with a youtube_video_id.
 *   3. Query the YouTube Analytics API v2 (`youtubeAnalytics.reports.query`,
 *      OAuth via getYoutubeOAuth — requires the `yt-analytics.readonly`
 *      scope) for a trailing `--days` window (default 30):
 *      views, averageViewDuration, averageViewPercentage, subscribersGained,
 *      dimensions=video filtered to our ids (chunked ≤50 ids per query —
 *      the API caps the `filters` string length).
 *   4. Upsert into `video_analytics` keyed on (video_id, synced_at=UTC date),
 *      so a same-day re-run updates rather than duplicates.
 *
 * METRIC HONESTY (logged every run): the API fills view_count,
 * watch_time_s (= averageViewDuration, mean s/view), completion_rate
 * (= averageViewPercentage) and subscribers_gained. CTR and 3s-retention are
 * YouTube-Studio-only; UTM link clicks are a site-side metric. Those columns
 * (ctr, retention_3s, link_clicks_utm) stay NULL — never zero-filled — so the
 * digest/kill-switch reader is never misled. `audio_lang` stays NULL until
 * the multi-audio-track test fills it.
 *
 * 403 insufficient-scope → prints problem/cause/fix (re-run
 * `bun scripts/youtube-oauth-setup.ts`, update YT_REFRESH_TOKEN) and exits 1
 * immediately — a config failure, not transient; no retry storm.
 *
 * MOCK_ALL=true → no API call: a canned report (analytics-map.ts::
 * cannedAnalyticsReport) flows through the real mapper + upsert, writing one
 * fixture row. Zero secrets, same discipline as pipeline/youtube/mocks/.
 *
 * Conforms to CLI-CONVENTIONS: --help/--json/--dry-run/--limit (+ --days).
 * Exit codes: 0 ok, 1 runtime failure (incl. missing scope), 2 usage error.
 */
import {
  ANALYTICS_API_METRICS,
  type AnalyticsReport,
  EXPIRED_TOKEN_FIX_MESSAGE,
  METRIC_HONESTY_LINE,
  SCOPE_FIX_MESSAGE,
  type VideoAnalyticsUpsert,
  cannedAnalyticsReport,
  chunkVideoIds,
  isExpiredRefreshTokenError,
  isInsufficientScopeError,
  mapAnalyticsReport,
  toVideoAnalyticsUpsert,
  trailingWindow,
  zeroActivityUpsert,
} from '../pipeline/youtube/analytics-map';
import { UsageError, parseCommonArgs, utcDate } from '../pipeline/youtube/cli';
import { log, logError, scrubError } from '../pipeline/youtube/log';
import { getYoutubeOAuth } from '../pipeline/youtube/secrets';
import { getVideosDb } from '../src/lib/videos-db';

const STAGE = 'analytics-sync';
const DEFAULT_DAYS = 30;

const USAGE = `youtube-analytics-sync — Cron E: YouTube Analytics API → video_analytics

Usage:
  bun scripts/youtube-analytics-sync.ts [--days=N] [--limit=N] [--dry-run] [--json]

Flags:
  --help        Show this help and exit 0
  --json        Machine-readable summary on stdout (logs stay on stderr)
  --dry-run     Plan only — list videos/chunks/window, no API call, no DB writes
  --limit=N     Cap the number of uploaded videos synced this run (default: all)
  --days=N      Trailing metrics window in days (default ${DEFAULT_DAYS})

Env:
  YOUTUBE_DB_PATH                      State DB path (crons: db/youtube-state.db)
  YOUTUBE_OAUTH_CLIENT_ID/_SECRET,
  YT_REFRESH_TOKEN                     OAuth (needs yt-analytics.readonly scope)
  MOCK_ALL=true                        No API call — canned report, one fixture row

Metric honesty:
  API-fillable: views, averageViewDuration, averageViewPercentage, subscribersGained.
  CTR + 3s-retention are Studio-only; UTM clicks are site-side — stored as NULL.

Exit codes:
  0 ok    1 runtime failure (incl. insufficient scope — see named fix)    2 usage error
`;

function isMockAll(): boolean {
  return process.env.MOCK_ALL === 'true';
}

interface UploadedVideo {
  id: number;
  youtube_video_id: string;
  lang: string;
}

/** Uploaded rows with a YouTube id — the analytics population. */
function pickUploaded(db: ReturnType<typeof getVideosDb>, limit?: number): UploadedVideo[] {
  const sql = `SELECT id, youtube_video_id, lang FROM videos
     WHERE status = 'uploaded' AND youtube_video_id IS NOT NULL
     ORDER BY id ASC${limit !== undefined ? ' LIMIT ?' : ''}`;
  return limit !== undefined
    ? db.query<UploadedVideo, [number]>(sql).all(limit)
    : db.query<UploadedVideo, []>(sql).all();
}

/**
 * Upsert one metrics row, keyed on UNIQUE(video_id, synced_at). The honesty
 * columns (ctr, retention_3s, link_clicks_utm) are written as literal NULLs
 * — see METRIC_HONESTY_LINE. `audio_lang` is the multi-audio-test dimension
 * (column added at M0; NULL until that test runs).
 */
function upsertAnalytics(db: ReturnType<typeof getVideosDb>, row: VideoAnalyticsUpsert): void {
  db.query(
    `INSERT INTO video_analytics (
       video_id, synced_at, view_count, watch_time_s, ctr, retention_3s,
       retention_50, completion_rate, link_clicks_utm, subscribers_gained, audio_lang
     ) VALUES (
       $video_id, $synced_at, $view_count, $watch_time_s, NULL, NULL,
       NULL, $completion_rate, NULL, $subscribers_gained, $audio_lang
     )
     ON CONFLICT(video_id, synced_at) DO UPDATE SET
       view_count = excluded.view_count,
       watch_time_s = excluded.watch_time_s,
       completion_rate = excluded.completion_rate,
       subscribers_gained = excluded.subscribers_gained,
       audio_lang = excluded.audio_lang`,
  ).run({
    $video_id: row.video_id,
    $synced_at: row.synced_at,
    $view_count: row.view_count,
    $watch_time_s: row.watch_time_s,
    $completion_rate: row.completion_rate,
    $subscribers_gained: row.subscribers_gained,
    $audio_lang: row.audio_lang,
  });
}

/**
 * Query one ≤50-id chunk via googleapis (dynamic import, mirroring
 * youtube-upload.ts). `auth` is built once by the caller.
 */
async function queryChunk(
  // biome-ignore lint/suspicious/noExplicitAny: dynamic googleapis import shape
  analytics: any,
  ids: string[],
  startDate: string,
  endDate: string,
): Promise<AnalyticsReport> {
  const res = await analytics.reports.query({
    ids: 'channel==MINE',
    startDate,
    endDate,
    metrics: ANALYTICS_API_METRICS.join(','),
    dimensions: 'video',
    filters: `video==${ids.join(',')}`,
  });
  return (res?.data ?? {}) as AnalyticsReport;
}

/** Build the youtubeAnalytics v2 client (dynamic import; real path only). */
// biome-ignore lint/suspicious/noExplicitAny: dynamic googleapis import shape
async function buildAnalyticsClient(): Promise<any> {
  const oauth = getYoutubeOAuth();
  const mod = await import('googleapis' as string).catch((e) => {
    throw new Error(`googleapis not installed: ${scrubError(e)}`);
  });
  // biome-ignore lint/suspicious/noExplicitAny: dynamic import shape
  const { google } = mod as any;
  const oauth2 = new google.auth.OAuth2(oauth.clientId, oauth.clientSecret);
  oauth2.setCredentials({ refresh_token: oauth.refreshToken });
  return google.youtubeAnalytics({ version: 'v2', auth: oauth2 });
}

async function main(): Promise<void> {
  let args: ReturnType<typeof parseCommonArgs>;
  try {
    args = parseCommonArgs(process.argv.slice(2), ['days']);
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

  let days = DEFAULT_DAYS;
  if ('days' in args.extra) {
    days = Number.parseInt(args.extra.days, 10);
    if (!Number.isFinite(days) || days < 1) {
      console.error(`bad --days: ${args.extra.days} (expected integer >= 1)`);
      process.exit(2);
    }
  }

  // Honesty contract — exactly once per run, before any metric line.
  log(STAGE, METRIC_HONESTY_LINE);

  const db = getVideosDb();
  const videos = pickUploaded(db, args.limit);
  const syncedAt = utcDate();
  const { startDate, endDate } = trailingWindow(days);

  if (videos.length === 0) {
    log(STAGE, 'no uploaded videos with a youtube_video_id — nothing to sync');
    if (args.json) {
      console.log(JSON.stringify({ syncedAt, days, videos: 0, rowsWritten: 0 }));
    }
    return;
  }

  const ids = videos.map((v) => v.youtube_video_id);
  const idToRowId = new Map(videos.map((v) => [v.youtube_video_id, v.id]));
  const chunks = chunkVideoIds(ids);
  log(STAGE, 'sync plan', {
    videos: videos.length,
    chunks: chunks.length,
    window: `${startDate}..${endDate}`,
  });

  if (args.dryRun) {
    log(STAGE, 'dry-run: would query the Analytics API and upsert video_analytics (skipped)');
    if (args.json) {
      console.log(
        JSON.stringify({
          dryRun: true,
          syncedAt,
          days,
          startDate,
          endDate,
          videos: videos.length,
          chunks: chunks.length,
        }),
      );
    }
    return;
  }

  // MOCK_ALL: no API, no secrets — one canned report row through the REAL
  // mapper + upsert path (mocks/ discipline: stub only the external call).
  if (isMockAll()) {
    const first = videos[0];
    const report = cannedAnalyticsReport([first.youtube_video_id]);
    const mapped = mapAnalyticsReport(report);
    for (const m of mapped) {
      upsertAnalytics(
        db,
        toVideoAnalyticsUpsert(m, idToRowId.get(m.youtubeVideoId) ?? first.id, syncedAt),
      );
    }
    log(STAGE, 'MOCK_ALL: wrote canned fixture row(s)', { rowsWritten: mapped.length });
    if (args.json) {
      console.log(JSON.stringify({ mock: true, syncedAt, days, rowsWritten: mapped.length }));
    }
    return;
  }

  const analytics = await buildAnalyticsClient();
  let rowsWritten = 0;
  let zeroActivity = 0;
  const seen = new Set<string>();

  for (const chunk of chunks) {
    let report: AnalyticsReport;
    try {
      report = await queryChunk(analytics, chunk, startDate, endDate);
    } catch (e) {
      if (isInsufficientScopeError(e)) {
        // Config failure, not transient — named fix, exit 1, NO retries.
        console.error(`[youtube:${STAGE}] ${SCOPE_FIX_MESSAGE}`);
        process.exit(1);
      }
      if (isExpiredRefreshTokenError(e)) {
        // Weekly Testing-mode token expiry — named rotation fix, exit 1, NO retries.
        console.error(`[youtube:${STAGE}] ${EXPIRED_TOKEN_FIX_MESSAGE}`);
        process.exit(1);
      }
      throw e; // → main catch → scrubbed log → exit 1
    }
    for (const m of mapAnalyticsReport(report)) {
      const rowId = idToRowId.get(m.youtubeVideoId);
      if (rowId === undefined) continue; // not ours (filtered query — shouldn't happen)
      upsertAnalytics(db, toVideoAnalyticsUpsert(m, rowId, syncedAt));
      seen.add(m.youtubeVideoId);
      rowsWritten++;
    }
  }

  // Videos the API returned nothing for had zero views in the window — a
  // real measurement (view_count=0); per-view averages stay NULL.
  for (const v of videos) {
    if (!seen.has(v.youtube_video_id)) {
      upsertAnalytics(db, zeroActivityUpsert(v.id, syncedAt));
      zeroActivity++;
      rowsWritten++;
    }
  }

  log(STAGE, 'sync complete', {
    videos: videos.length,
    rowsWritten,
    zeroActivity,
    window: `${startDate}..${endDate}`,
  });
  if (args.json) {
    console.log(
      JSON.stringify({
        syncedAt,
        days,
        startDate,
        endDate,
        videos: videos.length,
        rowsWritten,
        zeroActivity,
      }),
    );
  }
}

main().catch((e) => {
  logError(STAGE, e);
  process.exit(1);
});
