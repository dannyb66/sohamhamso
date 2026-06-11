#!/usr/bin/env bun
import { UsageError, parseCommonArgs } from '../pipeline/youtube/cli';
import { log, logError } from '../pipeline/youtube/log';
/**
 * scripts/youtube-lease-sweep.ts
 *
 * E4 — crash recovery. Flips rows stuck in `rendering`/`uploading` whose
 * lease timestamp is older than 1h back to `failed`, with
 * last_error='lease expired', so the next Cron A/B fire re-picks them.
 *
 * Conforms to CLI-CONVENTIONS: --help/--json/--dry-run.
 */
import { type VideoRow, getVideosDb } from '../src/lib/videos-db';

const STAGE = 'sweep';
const LEASE_TTL_MS = 60 * 60 * 1000; // 1h

const USAGE = `youtube-lease-sweep — unstick stale rendering/uploading leases (>1h)

Usage:
  bun scripts/youtube-lease-sweep.ts [--dry-run] [--json]

Flags:
  --help      Show this help and exit 0
  --json      Machine-readable summary
  --dry-run   Plan only — report what would flip, write nothing

Exit codes:
  0 ok    2 usage error
`;

interface StuckRow {
  id: number;
  status: string;
  lease: string | null;
  phase: 'render' | 'upload';
}

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

  const db = getVideosDb();
  const now = Date.now();
  const cutoff = now - LEASE_TTL_MS;

  const rendering = db.query<VideoRow, []>(`SELECT * FROM videos WHERE status = 'rendering'`).all();
  const uploading = db.query<VideoRow, []>(`SELECT * FROM videos WHERE status = 'uploading'`).all();

  const stuck: StuckRow[] = [];
  for (const r of rendering) {
    const t = r.rendering_lease_at ? Date.parse(r.rendering_lease_at) : 0;
    if (!r.rendering_lease_at || t < cutoff) {
      stuck.push({ id: r.id, status: r.status, lease: r.rendering_lease_at, phase: 'render' });
    }
  }
  for (const r of uploading) {
    const t = r.uploading_lease_at ? Date.parse(r.uploading_lease_at) : 0;
    if (!r.uploading_lease_at || t < cutoff) {
      stuck.push({ id: r.id, status: r.status, lease: r.uploading_lease_at, phase: 'upload' });
    }
  }

  if (!args.dryRun) {
    for (const s of stuck) {
      db.query(
        `UPDATE videos
            SET status = 'failed',
                last_error = 'lease expired',
                last_error_phase = $phase,
                updated_at = datetime('now')
          WHERE id = $id`,
      ).run({ $id: s.id, $phase: s.phase });
    }
  }

  const summary = { dryRun: args.dryRun, swept: stuck.length, ids: stuck.map((s) => s.id) };
  if (args.json) console.log(JSON.stringify(summary, null, 2));
  else
    log(STAGE, args.dryRun ? 'dry-run: would sweep' : 'swept stale leases', {
      count: stuck.length,
    });
}

try {
  main();
} catch (e) {
  logError(STAGE, e);
  process.exit(1);
}
