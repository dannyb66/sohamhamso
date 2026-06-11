#!/usr/bin/env bun
import { UsageError, parseCommonArgs, utcDate } from '../pipeline/youtube/cli';
import { loadYoutubeConfig } from '../pipeline/youtube/config';
import { log, logError } from '../pipeline/youtube/log';
/**
 * scripts/youtube-status.ts
 *
 * SQL-only ops dashboard: per-status row counts (countByStatus) + today's
 * quota for the configured channel. No secrets, no network — opens the
 * videos DB read-only.
 *
 * Conforms to CLI-CONVENTIONS: --help/--json.
 */
import { countByStatus, getQuotaToday, getVideosDb } from '../src/lib/videos-db';

const STAGE = 'status';

const USAGE = `youtube-status — SQL-only pipeline dashboard (counts + quota)

Usage:
  bun scripts/youtube-status.ts [--json] [--help]

Flags:
  --help   Show this help and exit 0
  --json   Emit a machine-readable JSON dashboard on stdout

Exit codes:
  0 ok    2 usage error
`;

function main(): void {
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

  const db = getVideosDb(undefined, true); // read-only
  const counts = countByStatus(db);
  const quotaRow = getQuotaToday(db, channel, today);
  const quota = {
    channel,
    date: today,
    unitsSpent: quotaRow?.units_spent ?? 0,
    uploadsCount: quotaRow?.uploads_count ?? 0,
    exhausted: Boolean(quotaRow?.exhausted),
  };

  const dashboard = { counts, quota };

  if (args.json) {
    console.log(JSON.stringify(dashboard, null, 2));
  } else {
    log(STAGE, 'counts', counts as unknown as Record<string, unknown>);
    log(STAGE, 'quota', {
      channel,
      date: today,
      units: quota.unitsSpent,
      uploads: quota.uploadsCount,
      exhausted: quota.exhausted,
    });
  }
}

try {
  main();
} catch (e) {
  logError(STAGE, e);
  process.exit(1);
}
