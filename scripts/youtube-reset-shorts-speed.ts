#!/usr/bin/env bun
/**
 * youtube-reset-shorts-speed.ts — one-shot: re-queue all un-published shorts so
 * they re-render at the new `defaults.speaking_rate` (0.75).
 *
 * Speaking rate is NOT part of the render determinism hash (deliberate — see
 * tts-request.ts), so a config change alone won't move already-rendered rows.
 * This resets every `format='short'` row in `approved` (rendered, queued) or
 * `failed` back to `pending`, so Cron A re-renders them. It NEVER touches
 * `uploaded` rows — the published catalogue stays exactly as-is.
 *
 * R2-state safety: it pulls fresh state from R2, mutates, and pushes back via
 * the SAME scripts/youtube-state-db.sh the crons use. Because the R2 DB is
 * last-writer-wins, RUN THIS WITH THE SHORTS CRONS PAUSED:
 *     gh workflow disable youtube-generate.yml
 *     gh workflow disable youtube-upload.yml
 *   … run this with --apply …
 *     gh workflow enable  youtube-generate.yml
 *     gh workflow enable  youtube-upload.yml
 *
 * USAGE (AWS creds + endpoint come from .env, auto-loaded by bun):
 *   bun run scripts/youtube-reset-shorts-speed.ts            # DRY RUN: pull + report only
 *   bun run scripts/youtube-reset-shorts-speed.ts --apply    # pull → reset → push
 */
import { spawnSync } from 'node:child_process';
import { Database } from 'bun:sqlite';
import { log } from '../pipeline/youtube/log';

const STAGE = 'reset-shorts-speed';
const STATE_DB = process.env.YOUTUBE_DB_PATH ?? 'db/youtube-state.db';
const RESET_FROM = ['approved', 'failed'] as const;

function sh(...args: string[]): void {
  const p = spawnSync('bash', ['scripts/youtube-state-db.sh', ...args], {
    stdio: 'inherit',
    env: process.env,
  });
  if (p.status !== 0) throw new Error(`youtube-state-db.sh ${args.join(' ')} exited ${p.status}`);
}

function main(): void {
  const apply = process.argv.includes('--apply');

  // Pin YOUTUBE_DB_PATH for the subprocess so youtube-state-db.sh pulls to —
  // and youtube-db-ensure operates on — the STATE db, exactly as the crons do
  // (its fallback is the corpus db/sohamhamso.db, which we must not touch).
  process.env.YOUTUBE_DB_PATH = STATE_DB;

  // 1. Pull fresh remote state (and ensure schema).
  sh('pull');

  const db = new Database(STATE_DB);
  const placeholders = RESET_FROM.map(() => '?').join(', ');

  // 2. Report what WOULD change — shorts only, never `uploaded`.
  const breakdown = db
    .query(
      `SELECT status, lang, COUNT(*) n FROM videos
       WHERE format = 'short' AND status IN (${placeholders})
       GROUP BY status, lang ORDER BY status, n DESC`,
    )
    .all(...RESET_FROM) as { status: string; lang: string; n: number }[];
  const total = breakdown.reduce((s, r) => s + r.n, 0);
  const uploaded = (
    db.query("SELECT COUNT(*) n FROM videos WHERE format='short' AND status='uploaded'").get() as {
      n: number;
    }
  ).n;

  log(STAGE, `shorts to re-queue (→ pending): ${total}`, {
    byStatus: RESET_FROM.map(
      (s) => `${s}=${breakdown.filter((r) => r.status === s).reduce((a, r) => a + r.n, 0)}`,
    ).join(' '),
    uploaded_untouched: uploaded,
  });
  for (const r of breakdown) log(STAGE, `  ${r.status} / ${r.lang}: ${r.n}`);

  if (!apply) {
    log(STAGE, 'DRY RUN — no rows changed, nothing pushed. Re-run with --apply to commit.');
    db.close();
    return;
  }

  // 3. Reset → pending. Clear render artifacts + leases + errors so each row is
  //    a clean re-render. Scoped to shorts; `uploaded` rows are never matched.
  const res = db
    .query(
      `UPDATE videos SET
         status = 'pending',
         output_file_sha256 = NULL,
         output_bytes = NULL,
         duration_s = NULL,
         r2_key = NULL,
         rendering_lease_at = NULL,
         uploading_lease_at = NULL,
         retry_count = 0,
         upload_retry_count = 0,
         last_error = NULL,
         last_error_phase = NULL,
         approved_at = NULL,
         approved_by = NULL,
         rendered_at = NULL,
         updated_at = datetime('now')
       WHERE format = 'short' AND status IN (${placeholders})`,
    )
    .run(...RESET_FROM);
  log(STAGE, `reset ${res.changes} short rows → pending`);
  db.close();

  // 4. Push mutated state back to R2.
  sh('push');
  log(STAGE, 'DONE — pushed. Re-enable the shorts crons; Cron A will re-render at 0.75.');
}

main();
