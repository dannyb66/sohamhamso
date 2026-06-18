#!/usr/bin/env bun
/**
 * seo-cf-logpush-setup — create the 72h post-launch Logpush job.
 *
 * Why this exists:
 *   The launch plan calls for a short-lived Logpush sink to R2 for the
 *   first 72h after going live, to surface 4xx/5xx hot spots, 0-byte
 *   responses (silent failures), OG endpoint health, and sitemap cache
 *   invalidation patterns. CF's Logpush API is programmable; this script
 *   creates the job in one shot. See `docs/CF-OBSERVABILITY-SETUP.md`
 *   for the full runbook.
 *
 * Usage:
 *   bun scripts/seo-cf-logpush-setup.ts           # real run, requires creds
 *   bun scripts/seo-cf-logpush-setup.ts --dry-run # print the request only
 *
 * Required env (real run only):
 *   CF_API_TOKEN          — token with Zone → Logs → Edit on sohamhamso.org
 *   CF_ACCOUNT_ID         — CF account id
 *   CF_ZONE_ID            — zone id for sohamhamso.org
 *   R2_ACCESS_KEY_ID      — R2 S3-API access key (separate from CF API token)
 *   R2_SECRET_ACCESS_KEY  — R2 S3-API secret
 *
 * On success, writes the job id to .gstack/launch/logpush-job-id.txt
 * (gitignored — read by seo-cf-logpush-disable.ts at T+72h).
 */

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ZONE_HOST = 'sohamhamso.org';
const R2_BUCKET = 'sohamhamso-backups';
const R2_PREFIX = 'logpush/72h-post-launch';
const JOB_NAME = 'sohamhamso-72h-post-launch';
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const JOB_ID_FILE = resolve(SCRIPT_DIR, '..', '.gstack', 'launch', 'logpush-job-id.txt');

const LOGPUSH_FIELDS = [
  'EdgeStartTimestamp',
  'ClientIP',
  'EdgeResponseStatus',
  'EdgeResponseBytes',
  'ClientRequestHost',
  'ClientRequestPath',
  'ClientRequestUserAgent',
  'ClientRequestReferer',
  'CacheCacheStatus',
] as const;

interface ParsedArgs {
  dryRun: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  let dryRun = false;
  for (const arg of argv) {
    if (arg === '--dry-run') dryRun = true;
  }
  return { dryRun };
}

interface Creds {
  cfApiToken: string;
  cfAccountId: string;
  cfZoneId: string;
  r2AccessKeyId: string;
  r2SecretAccessKey: string;
}

function readCreds(dryRun: boolean): Creds | null {
  const cfApiToken = process.env.CF_API_TOKEN ?? '';
  const cfAccountId = process.env.CF_ACCOUNT_ID ?? '';
  const cfZoneId = process.env.CF_ZONE_ID ?? '';
  const r2AccessKeyId = process.env.R2_ACCESS_KEY_ID ?? '';
  const r2SecretAccessKey = process.env.R2_SECRET_ACCESS_KEY ?? '';

  const missing = [
    ['CF_API_TOKEN', cfApiToken],
    ['CF_ACCOUNT_ID', cfAccountId],
    ['CF_ZONE_ID', cfZoneId],
    ['R2_ACCESS_KEY_ID', r2AccessKeyId],
    ['R2_SECRET_ACCESS_KEY', r2SecretAccessKey],
  ].filter(([_, v]) => !v);

  if (missing.length > 0) {
    if (!dryRun) {
      console.error(
        `[seo-cf-logpush-setup] missing required env vars: ${missing.map(([k]) => k).join(', ')}`,
      );
      console.error('[seo-cf-logpush-setup] re-run with --dry-run to preview the request.');
      return null;
    }
    // dry-run path: substitute placeholders so the printed body is realistic
    return {
      cfApiToken: cfApiToken || 'DRY_RUN_CF_API_TOKEN',
      cfAccountId: cfAccountId || 'DRY_RUN_CF_ACCOUNT_ID',
      cfZoneId: cfZoneId || 'DRY_RUN_CF_ZONE_ID',
      r2AccessKeyId: r2AccessKeyId || 'DRY_RUN_R2_ACCESS_KEY_ID',
      r2SecretAccessKey: r2SecretAccessKey || 'DRY_RUN_R2_SECRET_ACCESS_KEY',
    };
  }

  return {
    cfApiToken,
    cfAccountId,
    cfZoneId,
    r2AccessKeyId,
    r2SecretAccessKey,
  };
}

function buildDestinationConf(creds: Creds): string {
  // R2 logpush destination_conf shape per CF docs:
  //   r2://<BUCKET>/<PREFIX>/{DATE}?account-id=...&access-key-id=...&secret-access-key=...
  // The {DATE} placeholder is expanded by CF on each batch into a daily
  // subfolder (YYYY-MM-DD). Per-batch filenames (time + uniqueness) are
  // appended automatically by CF.
  const qs = new URLSearchParams({
    'account-id': creds.cfAccountId,
    'access-key-id': creds.r2AccessKeyId,
    'secret-access-key': creds.r2SecretAccessKey,
  }).toString();
  return `r2://${R2_BUCKET}/${R2_PREFIX}/{DATE}?${qs}`;
}

interface LogpushCreateBody {
  name: string;
  destination_conf: string;
  dataset: 'http_requests';
  enabled: boolean;
  filter: string;
  output_options: {
    field_names: readonly string[];
    output_type: 'ndjson';
    timestamp_format: 'rfc3339';
  };
  max_upload_interval_seconds: number;
}

function buildBody(creds: Creds): LogpushCreateBody {
  // Logpush "filter" is a JSON-encoded filter expression string.
  // Filtering on ClientRequestHost is more reliable than ZoneName.
  const filter = JSON.stringify({
    where: {
      and: [
        {
          key: 'ClientRequestHost',
          operator: 'eq',
          value: ZONE_HOST,
        },
      ],
    },
  });

  return {
    name: JOB_NAME,
    destination_conf: buildDestinationConf(creds),
    dataset: 'http_requests',
    enabled: true,
    filter,
    output_options: {
      field_names: LOGPUSH_FIELDS,
      output_type: 'ndjson',
      timestamp_format: 'rfc3339',
    },
    // Push batches every 5 minutes (max allowed). Keeps the tail tool's
    // "latest hour" view actually reflect the latest hour.
    max_upload_interval_seconds: 300,
  };
}

function redactBody(body: LogpushCreateBody): LogpushCreateBody {
  return {
    ...body,
    destination_conf: body.destination_conf.replace(/(secret-access-key=)[^&]+/, '$1REDACTED'),
  };
}

interface CFCreateResponse {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: Array<{ code: number; message: string }>;
  result?: {
    id: number;
    name: string;
    enabled: boolean;
    destination_conf: string;
    dataset: string;
  } | null;
}

async function postJob(creds: Creds, body: LogpushCreateBody): Promise<CFCreateResponse> {
  const url = `https://api.cloudflare.com/client/v4/zones/${creds.cfZoneId}/logpush/jobs`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${creds.cfApiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as CFCreateResponse;
  if (!res.ok || !json.success) {
    const errs =
      json.errors?.map((e) => `[${e.code}] ${e.message}`).join('; ') ?? `HTTP ${res.status}`;
    throw new Error(`Logpush create failed: ${errs}`);
  }
  return json;
}

async function writeJobId(jobId: number): Promise<void> {
  const dir = dirname(JOB_ID_FILE);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(JOB_ID_FILE, `${jobId}\n`, 'utf8');
}

async function main(): Promise<void> {
  const { dryRun } = parseArgs(process.argv.slice(2));
  const creds = readCreds(dryRun);
  if (!creds) {
    process.exit(1);
  }

  const body = buildBody(creds);
  const url = `https://api.cloudflare.com/client/v4/zones/${creds.cfZoneId}/logpush/jobs`;

  // Derive the capture window from "now" so the operator message stays honest
  // when this script runs late (the original hardcoded 2026-06-08 → 2026-06-11
  // strings were misleading by 2026-06-11+).
  const startIso = new Date().toISOString().slice(0, 10);
  const endIso = new Date(Date.now() + 72 * 3600 * 1000).toISOString().slice(0, 10);

  if (dryRun) {
    console.log('[seo-cf-logpush-setup] DRY RUN — no request will be sent.');
    console.log(`  POST ${url}`);
    console.log('  Headers:');
    console.log(`    Authorization: Bearer ${creds.cfApiToken.slice(0, 8)}...REDACTED`);
    console.log('    Content-Type: application/json');
    console.log('  Body:');
    console.log(JSON.stringify(redactBody(body), null, 2));
    console.log('');
    console.log(`  72h window target: ${startIso} → ${endIso} (UTC).`);
    console.log('  Disable at T+72h with: bun run seo:cf-logpush:disable');
    return;
  }

  console.log(`[seo-cf-logpush-setup] POST ${url}`);
  const response = await postJob(creds, body);
  const job = response.result;
  if (!job) {
    throw new Error('Logpush create returned success=true but no job result.');
  }

  await writeJobId(job.id);
  console.log(`[seo-cf-logpush-setup] OK — job id ${job.id} created and enabled.`);
  console.log(`  saved job id → ${JOB_ID_FILE}`);
  console.log(`  72h window: ${startIso} → ${endIso} (UTC)`);
  console.log('  Verify via dashboard: Logs → Logpush on the sohamhamso.org zone.');
  console.log('  Disable at T+72h with: bun run seo:cf-logpush:disable');
}

main().catch((err) => {
  console.error('[seo-cf-logpush-setup] error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
