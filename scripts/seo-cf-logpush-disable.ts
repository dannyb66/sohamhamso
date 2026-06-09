#!/usr/bin/env bun
/**
 * seo-cf-logpush-disable — disable the 72h post-launch Logpush job.
 *
 * Why this exists:
 *   The launch plan authorizes a 72h Logpush window, after which logs
 *   (which contain client IPs — PII) must stop accumulating in R2. This
 *   script PUTs `{enabled: false}` to the job created by
 *   `seo-cf-logpush-setup.ts`. Run once at T+72h
 *   (target: 2026-06-11 evening).
 *
 * Usage:
 *   bun scripts/seo-cf-logpush-disable.ts                  # uses job id from .gstack/launch/logpush-job-id.txt
 *   bun scripts/seo-cf-logpush-disable.ts --job-id=12345   # explicit id
 *   bun scripts/seo-cf-logpush-disable.ts --dry-run        # preview only
 *
 * Required env (real run only):
 *   CF_API_TOKEN  — same Zone → Logs → Edit token used at setup
 *   CF_ZONE_ID    — zone id for sohamhamso.org
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const JOB_ID_FILE = resolve(SCRIPT_DIR, '..', '.gstack', 'launch', 'logpush-job-id.txt');

interface ParsedArgs {
  dryRun: boolean;
  jobId: number | null;
}

function parseArgs(argv: string[]): ParsedArgs {
  let dryRun = false;
  let jobId: number | null = null;
  for (const arg of argv) {
    if (arg === '--dry-run') dryRun = true;
    else if (arg.startsWith('--job-id=')) {
      const v = Number.parseInt(arg.slice('--job-id='.length), 10);
      if (Number.isInteger(v) && v > 0) jobId = v;
    }
  }
  return { dryRun, jobId };
}

function resolveJobId(cli: number | null): number | null {
  if (cli != null) return cli;
  if (!existsSync(JOB_ID_FILE)) return null;
  const raw = readFileSync(JOB_ID_FILE, 'utf8').trim();
  const v = Number.parseInt(raw, 10);
  return Number.isInteger(v) && v > 0 ? v : null;
}

interface Creds {
  cfApiToken: string;
  cfZoneId: string;
}

function readCreds(dryRun: boolean): Creds | null {
  const cfApiToken = process.env.CF_API_TOKEN ?? '';
  const cfZoneId = process.env.CF_ZONE_ID ?? '';
  const missing = [
    ['CF_API_TOKEN', cfApiToken],
    ['CF_ZONE_ID', cfZoneId],
  ].filter(([_, v]) => !v);

  if (missing.length > 0) {
    if (!dryRun) {
      console.error(
        `[seo-cf-logpush-disable] missing required env vars: ${missing.map(([k]) => k).join(', ')}`,
      );
      console.error('[seo-cf-logpush-disable] re-run with --dry-run to preview the request.');
      return null;
    }
    return {
      cfApiToken: cfApiToken || 'DRY_RUN_CF_API_TOKEN',
      cfZoneId: cfZoneId || 'DRY_RUN_CF_ZONE_ID',
    };
  }
  return { cfApiToken, cfZoneId };
}

interface CFUpdateResponse {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: Array<{ code: number; message: string }>;
  result?: {
    id: number;
    enabled: boolean;
    name: string;
  } | null;
}

async function disableJob(creds: Creds, jobId: number): Promise<CFUpdateResponse> {
  const url = `https://api.cloudflare.com/client/v4/zones/${creds.cfZoneId}/logpush/jobs/${jobId}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${creds.cfApiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ enabled: false }),
  });
  const json = (await res.json()) as CFUpdateResponse;
  if (!res.ok || !json.success) {
    const errs =
      json.errors?.map((e) => `[${e.code}] ${e.message}`).join('; ') ?? `HTTP ${res.status}`;
    throw new Error(`Logpush disable failed: ${errs}`);
  }
  return json;
}

async function main(): Promise<void> {
  const { dryRun, jobId: cliJobId } = parseArgs(process.argv.slice(2));
  const creds = readCreds(dryRun);
  if (!creds) {
    process.exit(1);
  }

  const jobId = resolveJobId(cliJobId);
  if (jobId == null) {
    if (dryRun) {
      console.log('[seo-cf-logpush-disable] DRY RUN — no job id available.');
      console.log(
        `  Either re-run setup, or pass --job-id=<n> explicitly, or populate ${JOB_ID_FILE}.`,
      );
      console.log('  Sample request shape:');
      console.log(
        `    PUT https://api.cloudflare.com/client/v4/zones/${creds.cfZoneId}/logpush/jobs/<JOB_ID>`,
      );
      console.log(
        `    Headers: Authorization: Bearer ${creds.cfApiToken.slice(0, 8)}...REDACTED, Content-Type: application/json`,
      );
      console.log('    Body: {"enabled": false}');
      return;
    }
    console.error('[seo-cf-logpush-disable] no job id provided and none stored.');
    console.error(`  Either pass --job-id=<n> or restore ${JOB_ID_FILE}.`);
    process.exit(1);
  }

  const url = `https://api.cloudflare.com/client/v4/zones/${creds.cfZoneId}/logpush/jobs/${jobId}`;

  if (dryRun) {
    console.log('[seo-cf-logpush-disable] DRY RUN — no request will be sent.');
    console.log(`  PUT ${url}`);
    console.log('  Headers:');
    console.log(`    Authorization: Bearer ${creds.cfApiToken.slice(0, 8)}...REDACTED`);
    console.log('    Content-Type: application/json');
    console.log('  Body: {"enabled": false}');
    console.log('');
    console.log('  After disable, verify in CF dashboard: Logs → Logpush → job marked Disabled.');
    console.log('  Then plan a manual R2 purge of logpush/72h-post-launch/ when done analyzing.');
    return;
  }

  console.log(`[seo-cf-logpush-disable] PUT ${url}`);
  const response = await disableJob(creds, jobId);
  const job = response.result;
  if (!job) {
    throw new Error('Logpush disable returned success=true but no job result.');
  }
  console.log(`[seo-cf-logpush-disable] OK — job ${job.id} (${job.name}) enabled=${job.enabled}`);
  console.log('  Verify in CF dashboard: Logs → Logpush → job marked Disabled.');
  console.log('  Plan a manual R2 purge of logpush/72h-post-launch/ once analysis is complete.');
}

main().catch((err) => {
  console.error('[seo-cf-logpush-disable] error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
