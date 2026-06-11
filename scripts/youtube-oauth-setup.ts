#!/usr/bin/env bun
/**
 * scripts/youtube-oauth-setup.ts
 *
 * Single-channel OAuth bootstrap for @sohamhamso (E5). Scope is
 * `https://www.googleapis.com/auth/youtube.upload` ONLY — never the full
 * `youtube` scope (no channel/comment/playlist mutation blast radius).
 *
 * Flow:
 *   1. Print the consent URL.
 *   2. Operator authorizes, pastes the code back (--code=...).
 *   3. Exchange code → refresh token; write to .secrets/yt-refresh.txt.
 *   4. Print the `gh secret set YT_REFRESH_TOKEN` command.
 *
 * NEVER prints secrets to logs — uses scrubError on any thrown error and
 * does not echo the refresh token to stdout (only the file path + gh hint).
 *
 * `--refresh` documents the quarterly rotation (same flow; revoke old token
 * after via console.cloud.google.com/apis/credentials).
 *
 * Client id/secret read via getYoutubeOAuth (secrets chokepoint).
 * Conforms to CLI-CONVENTIONS: --help/--json/--dry-run.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { UsageError, parseCommonArgs } from '../pipeline/youtube/cli';
import { log, logError, scrubError } from '../pipeline/youtube/log';
import { getYoutubeOAuth } from '../pipeline/youtube/secrets';

const STAGE = 'rotation';
const SCOPE = 'https://www.googleapis.com/auth/youtube.upload';
const REDIRECT = 'urn:ietf:wg:oauth:2.0:oob'; // out-of-band, paste code back
const SECRET_PATH = '.secrets/yt-refresh.txt';

const USAGE = `youtube-oauth-setup — single-channel OAuth bootstrap (scope youtube.upload only)

Usage:
  Step 1 (print consent URL):
    bun scripts/youtube-oauth-setup.ts
  Step 2 (exchange the pasted code):
    bun scripts/youtube-oauth-setup.ts --code=PASTED_CODE

Flags:
  --help        Show this help and exit 0
  --json        Machine-readable output
  --dry-run     Print the consent URL only; never exchange or write
  --code=CODE   Authorization code from the consent screen (step 2)
  --refresh     Document the quarterly rotation flow (same steps)

Env (via pipeline/youtube/secrets.ts):
  YOUTUBE_OAUTH_CLIENT_ID, YOUTUBE_OAUTH_CLIENT_SECRET

Scope (locked): ${SCOPE}

Exit codes:
  0 ok    1 runtime failure    2 usage error
`;

const ROTATION_DOC = `OAuth quarterly rotation (E5):
  1. bun scripts/youtube-oauth-setup.ts            # get consent URL
  2. bun scripts/youtube-oauth-setup.ts --code=... # writes ${SECRET_PATH}
  3. gh secret set YT_REFRESH_TOKEN < ${SECRET_PATH}
  4. Revoke the OLD refresh token at
     https://console.cloud.google.com/apis/credentials
  5. Log the rotation to pipeline_runs (phase='rotation').`;

function buildConsentUrl(clientId: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent', // force a refresh_token on every run
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function exchangeCode(clientId: string, clientSecret: string, code: string): Promise<string> {
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: REDIRECT,
    grant_type: 'authorization_code',
  });
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!resp.ok) {
    // Do NOT include the response body verbatim — it can echo the code.
    throw new Error(`token exchange failed: HTTP ${resp.status}`);
  }
  const json = (await resp.json()) as { refresh_token?: string };
  if (!json.refresh_token) {
    throw new Error('no refresh_token in token response (re-run; prompt=consent forces one)');
  }
  return json.refresh_token;
}

async function main(): Promise<void> {
  let args: ReturnType<typeof parseCommonArgs>;
  try {
    args = parseCommonArgs(process.argv.slice(2), ['code', 'refresh']);
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
  if ('refresh' in args.extra) {
    console.log(ROTATION_DOC);
    return;
  }

  const oauth = getYoutubeOAuth();
  if (!oauth.clientId || !oauth.clientSecret) {
    console.error(
      '[youtube:rotation] YOUTUBE_OAUTH_CLIENT_ID / YOUTUBE_OAUTH_CLIENT_SECRET not set (see .env.example)',
    );
    process.exit(1);
  }

  const code = args.extra.code;

  // Step 1 — no code yet: print the consent URL.
  if (!code) {
    const url = buildConsentUrl(oauth.clientId);
    if (args.json) {
      console.log(JSON.stringify({ step: 'consent', scope: SCOPE, url }));
    } else {
      log(STAGE, 'open this consent URL, authorize, then re-run with --code=PASTED_CODE');
      console.log(url);
      console.log(`\nScope (locked): ${SCOPE}`);
    }
    return;
  }

  if (args.dryRun) {
    log(STAGE, 'dry-run: would exchange code + write refresh token (skipped)');
    return;
  }

  // Step 2 — exchange the code for a refresh token.
  const refreshToken = await exchangeCode(oauth.clientId, oauth.clientSecret, code);
  const outPath = resolve(process.cwd(), SECRET_PATH);
  mkdirSync(resolve(process.cwd(), '.secrets'), { recursive: true });
  writeFileSync(outPath, `${refreshToken}\n`, { mode: 0o600 });

  // NEVER print the token. Only the path + the gh command.
  log(STAGE, 'refresh token written (not printed)', { path: SECRET_PATH });
  console.log(`\nNext: gh secret set YT_REFRESH_TOKEN < ${SECRET_PATH}`);
  console.log('Then revoke any prior token at https://console.cloud.google.com/apis/credentials');
  if (args.json) {
    console.log(
      JSON.stringify({
        step: 'exchanged',
        wrote: SECRET_PATH,
        ghCommand: `gh secret set YT_REFRESH_TOKEN < ${SECRET_PATH}`,
      }),
    );
  }
}

main().catch((e) => {
  logError(STAGE, e);
  process.exit(1);
});
