#!/usr/bin/env bun
import { UsageError, parseCommonArgs } from '../pipeline/youtube/cli';
import { log, logError, scrubError } from '../pipeline/youtube/log';
import { getYoutubeOAuth } from '../pipeline/youtube/secrets';
/**
 * scripts/youtube-supersede-sweep.ts
 *
 * E2 — supersede policy. For rows marked `superseded` more than 30 days ago
 * that still have a live youtube_video_id, set superseded_action='auto-private'
 * (the old asset is hidden once the replacement has had a grace window).
 *
 * MOCK_ALL → DB-only (stamp the action). Real → also flip the live video to
 * private via googleapis youtube.videos.update.
 *
 * Conforms to CLI-CONVENTIONS: --help/--json/--dry-run/--limit.
 */
import { type VideoRow, getVideosDb } from '../src/lib/videos-db';

const STAGE = 'sweep';
const GRACE_DAYS = 30;

const USAGE = `youtube-supersede-sweep — auto-private superseded videos after 30d (E2)

Usage:
  bun scripts/youtube-supersede-sweep.ts [--dry-run] [--json] [--limit=N]

Flags:
  --help      Show this help and exit 0
  --json      Machine-readable summary
  --dry-run   Plan only — report candidates, write nothing
  --limit=N   Cap rows processed

Env:
  MOCK_ALL=true  DB-only (no YouTube call)

Exit codes:
  0 ok    1 runtime failure    2 usage error
`;

function isMockAll(): boolean {
  return process.env.MOCK_ALL === 'true';
}

async function setPrivate(youtubeId: string): Promise<void> {
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
  await youtube.videos.update({
    part: ['status'],
    requestBody: { id: youtubeId, status: { privacyStatus: 'private' } },
  });
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

  const db = getVideosDb();
  const limit = args.limit ?? Number.MAX_SAFE_INTEGER;

  // superseded > 30d ago, has a live youtube id, not yet auto-actioned.
  const candidates = db
    .query<VideoRow, [number]>(
      `SELECT * FROM videos
        WHERE status = 'superseded'
          AND youtube_video_id IS NOT NULL
          AND superseded_at IS NOT NULL
          AND superseded_at <= datetime('now', '-${GRACE_DAYS} days')
          AND (superseded_action IS NULL OR superseded_action != 'auto-private')
        ORDER BY superseded_at ASC
        LIMIT ?`,
    )
    .all(limit);

  let actioned = 0;
  const ids: number[] = [];
  for (const row of candidates) {
    ids.push(row.id);
    if (args.dryRun) continue;
    try {
      await setPrivate(row.youtube_video_id as string);
      db.query(
        `UPDATE videos
            SET superseded_action = 'auto-private',
                visibility = 'private',
                updated_at = datetime('now')
          WHERE id = $id`,
      ).run({ $id: row.id });
      actioned += 1;
    } catch (e) {
      log(STAGE, 'auto-private failed', { video: row.id });
      db.query(
        `UPDATE videos SET last_error = $err, last_error_phase = 'rotation', updated_at = datetime('now') WHERE id = $id`,
      ).run({ $id: row.id, $err: scrubError(e) });
    }
  }

  const summary = { dryRun: args.dryRun, candidates: candidates.length, actioned, ids };
  if (args.json) console.log(JSON.stringify(summary, null, 2));
  else
    log(STAGE, args.dryRun ? 'dry-run: candidates' : 'auto-private sweep', {
      candidates: candidates.length,
      actioned,
    });
}

main().catch((e) => {
  logError(STAGE, e);
  process.exit(1);
});
