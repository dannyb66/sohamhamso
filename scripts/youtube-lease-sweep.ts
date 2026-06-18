#!/usr/bin/env bun
import { UsageError, parseCommonArgs } from '../pipeline/youtube/cli';
import { log, logError } from '../pipeline/youtube/log';
/**
 * scripts/youtube-lease-sweep.ts
 *
 * E4 — crash recovery. Flips rows stuck in `rendering`/`uploading` whose
 * lease timestamp is older than the format's TTL back to `failed`, with
 * last_error='lease expired', so the next cron fire re-picks them.
 *
 * Format-aware TTL (eng decision #20): shorts keep 1h; `format='chapter'`
 * rows get 4h — a chapter render routinely runs 30–90 min (siva-sutras ch3
 * far longer), so a 1h TTL would sweep LIVE renders out from under the
 * cron; only the concurrency group protected them before.
 *
 * Conforms to CLI-CONVENTIONS: --help/--json/--dry-run.
 */
import { type VideoRow, getVideosDb } from '../src/lib/videos-db';

const STAGE = 'sweep';
export const LEASE_TTL_MS = 60 * 60 * 1000; // 1h — shorts
export const CHAPTER_LEASE_TTL_MS = 4 * 60 * 60 * 1000; // 4h — chapter renders are long

/** Per-format lease TTL (the one `if` of the format-aware sweep). */
export function leaseTtlMsFor(format: string | null | undefined): number {
  return format === 'chapter' ? CHAPTER_LEASE_TTL_MS : LEASE_TTL_MS;
}

/** True when a lease timestamp is stale against `now` for its TTL. */
export function isLeaseStale(
  leaseAtIso: string | null,
  nowMs: number,
  ttlMs: number = LEASE_TTL_MS,
): boolean {
  if (!leaseAtIso) return true; // mid-flight with no lease stamp = stuck
  const t = Date.parse(leaseAtIso);
  if (Number.isNaN(t)) return true;
  return t < nowMs - ttlMs;
}

const USAGE = `youtube-lease-sweep — unstick stale rendering/uploading leases (>1h shorts, >4h chapters)

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
  format: string;
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

  const rendering = db.query<VideoRow, []>(`SELECT * FROM videos WHERE status = 'rendering'`).all();
  const uploading = db.query<VideoRow, []>(`SELECT * FROM videos WHERE status = 'uploading'`).all();

  const stuck: StuckRow[] = [];
  for (const r of rendering) {
    if (isLeaseStale(r.rendering_lease_at, now, leaseTtlMsFor(r.format))) {
      stuck.push({
        id: r.id,
        status: r.status,
        lease: r.rendering_lease_at,
        format: r.format ?? 'short',
        phase: 'render',
      });
    }
  }
  for (const r of uploading) {
    if (isLeaseStale(r.uploading_lease_at, now, leaseTtlMsFor(r.format))) {
      stuck.push({
        id: r.id,
        status: r.status,
        lease: r.uploading_lease_at,
        format: r.format ?? 'short',
        phase: 'upload',
      });
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

if (import.meta.main) {
  try {
    main();
  } catch (e) {
    logError(STAGE, e);
    process.exit(1);
  }
}
