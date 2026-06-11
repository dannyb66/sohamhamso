#!/usr/bin/env bun
import { UsageError, parseCommonArgs, utcDate } from '../pipeline/youtube/cli';
import { loadYoutubeConfig } from '../pipeline/youtube/config';
import { log, logError, scrubError } from '../pipeline/youtube/log';
import { getYoutubeOAuth } from '../pipeline/youtube/secrets';
/**
 * scripts/youtube-revisit.ts
 *
 * D4 — change a live video's visibility/title WITHOUT re-rendering. The
 * operator's path to flip an unlisted review video → public after watching
 * it in YouTube Studio. ~50 quota units (videos.update).
 *
 * Usage:
 *   bun scripts/youtube-revisit.ts --video-id=N --visibility=public|unlisted|private [--title=...]
 *
 * MOCK_ALL → no YouTube call (DB-only). Real → googleapis youtube.videos.update.
 * Conforms to CLI-CONVENTIONS: --help/--json/--dry-run.
 */
import { type VideoRow, addQuotaUnits, getVideosDb, updateVideoStatus } from '../src/lib/videos-db';

const STAGE = 'upload';
const UNITS_PER_UPDATE = 50;
const VISIBILITIES = ['public', 'unlisted', 'private'] as const;
type Visibility = (typeof VISIBILITIES)[number];

const USAGE = `youtube-revisit — change visibility/title without re-render (videos.update)

Usage:
  bun scripts/youtube-revisit.ts --video-id=N --visibility=public|unlisted|private [--title=...]
                                 [--dry-run] [--json]

Flags:
  --help               Show this help and exit 0
  --json               Machine-readable summary
  --dry-run            Plan only — no YouTube call, no DB write
  --video-id=N         videos.id (required)
  --visibility=V       public | unlisted | private (required)
  --title=...          New title (optional)

Env:
  MOCK_ALL=true        DB-only, no YouTube call

Exit codes:
  0 ok    1 runtime failure    2 usage error
`;

function isMockAll(): boolean {
  return process.env.MOCK_ALL === 'true';
}

async function youtubeUpdate(
  videoId: string,
  visibility: Visibility,
  title: string | undefined,
): Promise<void> {
  if (isMockAll()) return;
  const oauth = getYoutubeOAuth();
  const mod = await import('googleapis' as string).catch((e) => {
    throw new Error(`googleapis not installed: ${scrubError(e)}`);
  });
  // biome-ignore lint/suspicious/noExplicitAny: dynamic import shape (dep installed later)
  const { google } = mod as any;
  const oauth2 = new google.auth.OAuth2(oauth.clientId, oauth.clientSecret);
  oauth2.setCredentials({ refresh_token: oauth.refreshToken });
  const youtube = google.youtube({ version: 'v3', auth: oauth2 });

  // biome-ignore lint/suspicious/noExplicitAny: googleapis request body shape (dep installed later)
  const requestBody: any = { id: videoId, status: { privacyStatus: visibility } };
  const part = ['status'];
  if (title) {
    // videos.update requires categoryId when updating snippet; fetch current.
    const cur = await youtube.videos.list({ part: ['snippet'], id: [videoId] });
    const snippet = cur?.data?.items?.[0]?.snippet ?? {};
    requestBody.snippet = { ...snippet, title };
    part.push('snippet');
  }
  await youtube.videos.update({ part, requestBody });
}

async function main(): Promise<void> {
  let args: ReturnType<typeof parseCommonArgs>;
  try {
    args = parseCommonArgs(process.argv.slice(2), ['video-id', 'visibility', 'title']);
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

  const videoIdRaw = args.extra['video-id'];
  const visibility = args.extra.visibility as Visibility | undefined;
  const title = args.extra.title;

  if (!videoIdRaw) {
    console.error('[youtube:upload] --video-id=N is required');
    process.exit(2);
  }
  const dbId = Number.parseInt(videoIdRaw, 10);
  if (!Number.isFinite(dbId)) {
    console.error('[youtube:upload] --video-id must be an integer');
    process.exit(2);
  }
  if (!visibility || !VISIBILITIES.includes(visibility)) {
    console.error(`[youtube:upload] --visibility must be one of ${VISIBILITIES.join('|')}`);
    process.exit(2);
  }

  const cfg = loadYoutubeConfig();
  const db = getVideosDb();
  const row = db.query<VideoRow, [number]>('SELECT * FROM videos WHERE id = ? LIMIT 1').get(dbId);
  if (!row) {
    console.error(`[youtube:upload] no video row id=${dbId}`);
    process.exit(1);
  }
  if (!row.youtube_video_id) {
    console.error(`[youtube:upload] video id=${dbId} has no youtube_video_id (not uploaded yet)`);
    process.exit(1);
  }

  if (args.dryRun) {
    log(STAGE, 'dry-run: would update', {
      video: dbId,
      youtube: row.youtube_video_id,
      visibility,
      title: title ?? '(unchanged)',
    });
    if (args.json) console.log(JSON.stringify({ dryRun: true, dbId, visibility, title }));
    return;
  }

  await youtubeUpdate(row.youtube_video_id, visibility, title);
  updateVideoStatus(db, dbId, row.status, { visibility });
  addQuotaUnits(db, cfg.defaults.channel_handle, utcDate(), UNITS_PER_UPDATE, 0);

  log(STAGE, 'revisited', { video: dbId, youtube: row.youtube_video_id, visibility });
  if (args.json) {
    console.log(
      JSON.stringify({
        ok: true,
        dbId,
        youtubeId: row.youtube_video_id,
        visibility,
        title: title ?? null,
      }),
    );
  }
}

main().catch((e) => {
  logError(STAGE, e);
  process.exit(1);
});
