/**
 * src/lib/videos-db.ts
 *
 * Read/write API for the YouTube Shorts pipeline `videos` lifecycle table
 * (+ pipeline_runs / youtube_quota). Mirrors:
 *   - the `getDb()` connection pattern in `src/lib/db.ts:166`
 *   - the bun:sqlite writer pattern in `src/lib/subscriber-db.ts`
 *
 * Runtime: Bun (`bun:sqlite`, synchronous). Phase 1 runs entirely in the
 * bun runtime (CI / local / GHA), so unlike subscriber-db there is no
 * edge/libsql fork — the sync driver is sufficient and simpler.
 *
 * Determinism contract: a row is keyed by
 *   (text_id, chapter, verse_num, lang, short_index, translation_md5, template_version)
 * and re-render is decided by `shouldSkipRender()` (no input_hash, per E1).
 *
 * Mutation discipline:
 *   - `last_error` is written ONLY via a caller-supplied, already-scrubbed
 *     string (pipeline/youtube/log.ts::scrubError) — this module does not
 *     scrub for you, but it never logs raw errors either.
 *   - every status mutation bumps `updated_at`.
 */

// biome-ignore lint/correctness/noUndeclaredDependencies: bun built-in
import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type VideoStatus =
  | 'pending'
  | 'rendering'
  | 'rendered'
  | 'approved'
  | 'rejected'
  | 'uploading'
  | 'uploaded'
  | 'failed'
  | 'superseded';

/** Full `videos` row as stored. Nullable columns are `T | null`. */
export interface VideoRow {
  id: number;
  // Identity
  text_id: string;
  chapter: number;
  verse_num: number;
  lang: string;
  short_index: number;
  channel_handle: string;
  kula: string;
  style_preset: string;
  // Determinism
  translation_md5: string;
  template_version: string;
  output_file_sha256: string | null;
  output_bytes: number | null;
  // Pinned provenance
  tts_voice_id: string;
  translation_row_id: number;
  remotion_version: string;
  ffmpeg_version: string;
  // Lifecycle
  status: VideoStatus;
  // Leases (E4)
  rendering_lease_at: string | null;
  uploading_lease_at: string | null;
  // Storage refs
  r2_key: string | null;
  duration_s: number | null;
  youtube_video_id: string | null;
  youtube_url: string | null;
  visibility: 'unlisted' | 'public' | 'private' | null;
  // Audit
  retry_count: number | null;
  upload_retry_count: number | null;
  last_error: string | null;
  last_error_phase: string | null;
  approved_at: string | null;
  approved_by: string | null;
  rendered_at: string | null;
  uploaded_at: string | null;
  priority: number | null;
  // Supersede (E2)
  supersedes_video_id: number | null;
  superseded_at: string | null;
  superseded_action: 'auto-private' | 'replace-asset' | 'manual' | null;
  created_at: string | null;
  updated_at: string | null;
}

/**
 * Insert shape for a fresh `pending` row. Only the NOT-NULL identity +
 * provenance + determinism columns; lifecycle defaults to 'pending' if
 * `status` is omitted.
 */
export interface NewVideoRow {
  text_id: string;
  chapter: number;
  verse_num: number;
  lang: string;
  short_index?: number;
  channel_handle?: string;
  kula: string;
  style_preset: string;
  translation_md5: string;
  template_version: string;
  tts_voice_id: string;
  translation_row_id: number;
  remotion_version: string;
  ffmpeg_version: string;
  status?: VideoStatus;
}

/** Identity tuple used to look up the latest row for a verse/lang/short. */
export interface VideoIdent {
  text_id: string;
  chapter: number;
  verse_num: number;
  lang: string;
  short_index: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Connection (mirrors src/lib/db.ts getDb)
// ─────────────────────────────────────────────────────────────────────────────

let _db: Database | null = null;

function dbPath(): string {
  // First-priority override for the youtube-pipeline state DB. The committed
  // corpus lives in `db/sohamhamso.db`; mutable youtube lifecycle state is a
  // separate R2-synced file, so the crons point this at `db/youtube-state.db`.
  // Checked before SOHAMHAMSO_DB_PATH so the corpus override stays independent.
  if (process.env.YOUTUBE_DB_PATH) return process.env.YOUTUBE_DB_PATH;
  if (process.env.SOHAMHAMSO_DB_PATH) return process.env.SOHAMHAMSO_DB_PATH;
  const cwdPath = resolve(process.cwd(), 'db', 'sohamhamso.db');
  if (existsSync(cwdPath)) return cwdPath;
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', 'db', 'sohamhamso.db');
}

/**
 * Returns a `videos` DB handle. Unlike the read-only corpus singleton in
 * `db.ts`, the default here is a WRITABLE shared connection (the pipeline
 * mutates lifecycle state).
 *
 * When `path` is provided, opens a fresh non-cached connection (tests with
 * `:memory:` / temp DBs). `readonly` (default `false`) opens a read-only
 * handle for dashboards.
 */
export function getVideosDb(path?: string, readonly = false): Database {
  // bun:sqlite requires an explicit open mode; `{ readonly: false }` alone
  // throws ("flags must include SQLITE_OPEN_READONLY or _READWRITE") on
  // bun >= 1.3. Use `{ readonly:true }` for reads and `{ create:true }`
  // (implies read-write + create-if-missing) for the writable path.
  const openOpts = readonly ? { readonly: true } : { create: true };
  // NOTE: do NOT force `journal_mode = WAL` here. Locally the `videos` table
  // shares the single `db/sohamhamso.db` file with the read-only corpus
  // tables, and `getDb()` holds a concurrent `readonly` connection to that
  // same file. Flipping a shared file to WAL out from under an already-open
  // rollback-journal reader breaks it with SQLITE_CANTOPEN ("unable to open
  // database file"). WAL also buys nothing here: this writable path is a
  // single-process local/CI tool; production writes go to Turso (libSQL),
  // not bun:sqlite. A busy_timeout is the useful, reader-safe pragma.
  if (path !== undefined) {
    const db = new Database(path, openOpts);
    if (readonly) db.exec('PRAGMA query_only = ON;');
    else db.exec('PRAGMA busy_timeout = 5000;');
    return db;
  }
  if (_db) return _db;
  _db = new Database(dbPath(), openOpts);
  if (readonly) _db.exec('PRAGMA query_only = ON;');
  else _db.exec('PRAGMA busy_timeout = 5000;');
  return _db;
}

/** Test hook — inject/clear the module singleton. */
export function __setVideosDbForTests(db: Database | null): void {
  _db = db;
}

const ALL_STATUSES: VideoStatus[] = [
  'pending',
  'rendering',
  'rendered',
  'approved',
  'rejected',
  'uploading',
  'uploaded',
  'failed',
  'superseded',
];

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Latest row (highest id) for an identity tuple, or null. This is the
 * row the re-render decision (`shouldSkipRender`) is made against.
 */
export function getLatestVideo(db: Database, ident: VideoIdent): VideoRow | null {
  const row = db
    .query<VideoRow, [string, number, number, string, number]>(
      `SELECT * FROM videos
       WHERE text_id = ? AND chapter = ? AND verse_num = ? AND lang = ? AND short_index = ?
       ORDER BY id DESC LIMIT 1`,
    )
    .get(ident.text_id, ident.chapter, ident.verse_num, ident.lang, ident.short_index);
  return row ?? null;
}

/**
 * Rows in a given status, oldest first, capped at `limit`. Optional `text_id` /
 * `lang` filters are pushed into SQL so callers like `youtube-render --text-slug`
 * reach matching rows even when they sit beyond the first `limit` rows of the
 * full pending set (otherwise a post-fetch filter silently returns nothing).
 */
export function listByStatus(
  db: Database,
  status: VideoStatus,
  limit: number,
  opts: { textId?: string; lang?: string } = {},
): VideoRow[] {
  const clauses = ['status = ?'];
  const params: (string | number)[] = [status];
  if (opts.textId) {
    clauses.push('text_id = ?');
    params.push(opts.textId);
  }
  if (opts.lang) {
    clauses.push('lang = ?');
    params.push(opts.lang);
  }
  params.push(limit);
  return db
    .query<VideoRow, (string | number)[]>(
      `SELECT * FROM videos WHERE ${clauses.join(' AND ')}
       ORDER BY priority DESC, id ASC LIMIT ?`,
    )
    .all(...params);
}

/** Count of rows per status. Every status key is present (0 if none). */
export function countByStatus(db: Database): Record<VideoStatus, number> {
  const counts = Object.fromEntries(ALL_STATUSES.map((s) => [s, 0])) as Record<VideoStatus, number>;
  const rows = db
    .query<{ status: VideoStatus; n: number }, []>(
      'SELECT status, COUNT(*) AS n FROM videos GROUP BY status',
    )
    .all();
  for (const r of rows) {
    if (r.status in counts) counts[r.status] = r.n;
  }
  return counts;
}

// ─────────────────────────────────────────────────────────────────────────────
// Writes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Insert a fresh row (INSERT OR IGNORE on the UNIQUE determinism key).
 * Returns the new rowid, or — if a row already exists for that exact key —
 * the existing row's id (so the caller always gets a usable id).
 */
export function insertPending(db: Database, row: NewVideoRow): number {
  const info = db
    .query(
      `INSERT OR IGNORE INTO videos (
         text_id, chapter, verse_num, lang, short_index, channel_handle,
         kula, style_preset, translation_md5, template_version,
         tts_voice_id, translation_row_id, remotion_version, ffmpeg_version,
         status
       ) VALUES (
         $text_id, $chapter, $verse_num, $lang, $short_index, $channel_handle,
         $kula, $style_preset, $translation_md5, $template_version,
         $tts_voice_id, $translation_row_id, $remotion_version, $ffmpeg_version,
         $status
       )`,
    )
    .run({
      $text_id: row.text_id,
      $chapter: row.chapter,
      $verse_num: row.verse_num,
      $lang: row.lang,
      $short_index: row.short_index ?? 0,
      $channel_handle: row.channel_handle ?? '@sohamhamso',
      $kula: row.kula,
      $style_preset: row.style_preset,
      $translation_md5: row.translation_md5,
      $template_version: row.template_version,
      $tts_voice_id: row.tts_voice_id,
      $translation_row_id: row.translation_row_id,
      $remotion_version: row.remotion_version,
      $ffmpeg_version: row.ffmpeg_version,
      $status: row.status ?? 'pending',
    });

  if (info.changes > 0) return Number(info.lastInsertRowid);

  // INSERT was ignored — a row with this exact determinism key exists.
  const existing = db
    .query<{ id: number }, [string, number, number, string, number, string, string]>(
      `SELECT id FROM videos
       WHERE text_id = ? AND chapter = ? AND verse_num = ? AND lang = ?
         AND short_index = ? AND translation_md5 = ? AND template_version = ?
       LIMIT 1`,
    )
    .get(
      row.text_id,
      row.chapter,
      row.verse_num,
      row.lang,
      row.short_index ?? 0,
      row.translation_md5,
      row.template_version,
    );
  return existing ? existing.id : 0;
}

/**
 * Mark a row `superseded` with a supersede action (E2). Bumps updated_at
 * and stamps superseded_at.
 */
export function markSuperseded(db: Database, id: number, action: string): void {
  db.query(
    `UPDATE videos
       SET status = 'superseded',
           superseded_action = $action,
           superseded_at = datetime('now'),
           updated_at = datetime('now')
     WHERE id = $id`,
  ).run({ $id: id, $action: action });
}

/** Columns a caller may patch via updateVideoStatus. */
type VideoPatchable = Partial<
  Pick<
    VideoRow,
    | 'output_file_sha256'
    | 'output_bytes'
    | 'rendering_lease_at'
    | 'uploading_lease_at'
    | 'r2_key'
    | 'duration_s'
    | 'youtube_video_id'
    | 'youtube_url'
    | 'visibility'
    | 'retry_count'
    | 'upload_retry_count'
    | 'last_error'
    | 'last_error_phase'
    | 'approved_at'
    | 'approved_by'
    | 'rendered_at'
    | 'uploaded_at'
    | 'priority'
    | 'supersedes_video_id'
  >
>;

const PATCHABLE_COLUMNS: (keyof VideoPatchable)[] = [
  'output_file_sha256',
  'output_bytes',
  'rendering_lease_at',
  'uploading_lease_at',
  'r2_key',
  'duration_s',
  'youtube_video_id',
  'youtube_url',
  'visibility',
  'retry_count',
  'upload_retry_count',
  'last_error',
  'last_error_phase',
  'approved_at',
  'approved_by',
  'rendered_at',
  'uploaded_at',
  'priority',
  'supersedes_video_id',
];

/**
 * Flip a row's status and optionally patch a whitelisted set of columns.
 * Always bumps updated_at. `last_error` must be a pre-scrubbed string
 * (caller's responsibility — pass `scrubError(err)`).
 */
export function updateVideoStatus(
  db: Database,
  id: number,
  status: VideoStatus,
  patch: VideoPatchable = {},
): void {
  const sets: string[] = ['status = $status', "updated_at = datetime('now')"];
  const params: Record<string, unknown> = { $id: id, $status: status };
  for (const col of PATCHABLE_COLUMNS) {
    if (col in patch && patch[col] !== undefined) {
      sets.push(`${col} = $${col}`);
      params[`$${col}`] = patch[col] as unknown;
    }
  }
  db.query(`UPDATE videos SET ${sets.join(', ')} WHERE id = $id`).run(params);
}

/** A pipeline_runs insert payload. */
export interface PipelineRunInsert {
  run_id: string;
  video_id?: number | null;
  phase: 'plan' | 'render' | 'probe' | 'upload' | 'status' | 'rotation';
  status: 'ok' | 'err' | 'skip' | 'dryrun';
  duration_ms?: number | null;
  tts_bytes_synthesized?: number;
  r2_bytes_written?: number;
  youtube_api_units?: number;
  error_code?: string | null;
  error_msg?: string | null; // must be pre-scrubbed
  started_at?: string | null;
  finished_at: string;
}

/** Append a row to pipeline_runs (the structured run log). */
export function recordPipelineRun(db: Database, run: PipelineRunInsert): void {
  db.query(
    `INSERT INTO pipeline_runs (
       run_id, video_id, phase, status, duration_ms,
       tts_bytes_synthesized, r2_bytes_written, youtube_api_units,
       error_code, error_msg, started_at, finished_at
     ) VALUES (
       $run_id, $video_id, $phase, $status, $duration_ms,
       $tts_bytes_synthesized, $r2_bytes_written, $youtube_api_units,
       $error_code, $error_msg, COALESCE($started_at, datetime('now')), $finished_at
     )`,
  ).run({
    $run_id: run.run_id,
    $video_id: run.video_id ?? null,
    $phase: run.phase,
    $status: run.status,
    $duration_ms: run.duration_ms ?? null,
    $tts_bytes_synthesized: run.tts_bytes_synthesized ?? 0,
    $r2_bytes_written: run.r2_bytes_written ?? 0,
    $youtube_api_units: run.youtube_api_units ?? 0,
    $error_code: run.error_code ?? null,
    $error_msg: run.error_msg ?? null,
    $started_at: run.started_at ?? null,
    $finished_at: run.finished_at,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Quota helpers
// ─────────────────────────────────────────────────────────────────────────────

export interface QuotaRow {
  id: number;
  channel_handle: string;
  utc_date: string;
  units_spent: number;
  uploads_count: number;
  exhausted: number;
}

/** Today's quota row for a channel, or null if none recorded yet. */
export function getQuotaToday(db: Database, channel: string, utcDate: string): QuotaRow | null {
  const row = db
    .query<QuotaRow, [string, string]>(
      'SELECT * FROM youtube_quota WHERE channel_handle = ? AND utc_date = ? LIMIT 1',
    )
    .get(channel, utcDate);
  return row ?? null;
}

/**
 * Add `units` (and `uploads`) to today's quota counter, upserting the
 * (channel, utc_date) row. Idempotent on the UNIQUE key via ON CONFLICT.
 */
export function addQuotaUnits(
  db: Database,
  channel: string,
  utcDate: string,
  units: number,
  uploads: number,
): void {
  db.query(
    `INSERT INTO youtube_quota (channel_handle, utc_date, units_spent, uploads_count)
       VALUES ($channel, $date, $units, $uploads)
     ON CONFLICT(channel_handle, utc_date) DO UPDATE SET
       units_spent = units_spent + $units,
       uploads_count = uploads_count + $uploads`,
  ).run({ $channel: channel, $date: utcDate, $units: units, $uploads: uploads });
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-render decision (no input_hash — translation_md5 + template_version)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * True if rendering should be SKIPPED: the latest row exists, is in a
 * terminal-good state (rendered/approved/uploaded), and both the
 * translation md5 and template version still match. Otherwise the caller
 * marks the old row superseded and inserts a fresh pending row.
 */
export function shouldSkipRender(
  latest: VideoRow | null,
  translation_md5: string,
  template_version: string,
): boolean {
  if (!latest) return false;
  const goodStates: VideoStatus[] = ['rendered', 'approved', 'uploaded'];
  return (
    goodStates.includes(latest.status) &&
    latest.translation_md5 === translation_md5 &&
    latest.template_version === template_version
  );
}
