#!/usr/bin/env bun
/**
 * scripts/youtube-oauth-setup.ts
 *
 * Single-channel OAuth bootstrap for @sohamhamso (E5). Scope is the UNION
 * of exactly the three scopes the pipeline needs (one consent, M0.5):
 *   - youtube.upload          — Cron B videos.insert
 *   - yt-analytics.readonly   — Cron E analytics sync (youtube-analytics-sync.ts)
 *   - youtube.force-ssl       — videos.update (youtube-revisit flip-public,
 *                               youtube-supersede-sweep auto-private,
 *                               youtube-update-seo)
 * NEVER the full `youtube` scope (no channel/comment/playlist mutation
 * blast radius beyond the explicit three above).
 *
 * Flow:
 *   1. Print the consent URL.
 *   2. Operator authorizes, pastes the code back (--code=...).
 *   3. Exchange code → refresh token; write to .secrets/yt-refresh.txt.
 *   4. Print the GRANTED scopes (from the token response / tokeninfo) and
 *      warn LOUDLY if any of the three required scopes is missing.
 *   5. Print the `gh secret set YT_REFRESH_TOKEN` command.
 *
 * NEVER prints secrets to logs — uses scrubError on any thrown error and
 * does not echo the refresh/access token to stdout (only the file path +
 * gh hint). The scope list itself is not a secret.
 *
 * `--refresh` documents the quarterly rotation (same flow; revoke old token
 * after via console.cloud.google.com/apis/credentials). Re-running this
 * script is idempotent: prompt=consent always mints a fresh refresh token;
 * swap the YT_REFRESH_TOKEN secret atomically between cron fires.
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
/** The exact scopes the pipeline needs — one consent covers all three crons. */
const REQUIRED_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload', // Cron B videos.insert
  'https://www.googleapis.com/auth/yt-analytics.readonly', // Cron E analytics sync
  'https://www.googleapis.com/auth/youtube.force-ssl', // videos.update (revisit/supersede/seo)
] as const;
const SCOPE = REQUIRED_SCOPES.join(' ');
const REDIRECT = 'urn:ietf:wg:oauth:2.0:oob'; // out-of-band, paste code back
const SECRET_PATH = '.secrets/yt-refresh.txt';

const USAGE = `youtube-oauth-setup — single-channel OAuth bootstrap (3-scope union: upload + yt-analytics.readonly + force-ssl)

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
  --refresh     Document the quarterly rotation flow (same steps; re-running
                this script is idempotent — prompt=consent always mints a
                fresh refresh token)

Env (via pipeline/youtube/secrets.ts):
  YOUTUBE_OAUTH_CLIENT_ID, YOUTUBE_OAUTH_CLIENT_SECRET

Scopes (locked union):
${REQUIRED_SCOPES.map((s) => `  ${s}`).join('\n')}

After minting, the GRANTED scopes are printed and a loud warning is shown
if any of the three is missing (Cron B/E or videos.update would break).

Exit codes:
  0 ok    1 runtime failure    2 usage error
`;

const ROTATION_DOC = `OAuth quarterly rotation (E5):
  1. bun scripts/youtube-oauth-setup.ts            # get consent URL (3-scope union)
  2. bun scripts/youtube-oauth-setup.ts --code=... # writes ${SECRET_PATH}
     (verify the printed GRANTED scopes include all three — upload,
      yt-analytics.readonly, force-ssl — or Cron B/E + videos.update regress)
  3. gh secret set YT_REFRESH_TOKEN < ${SECRET_PATH}
  4. Revoke the OLD refresh token at
     https://console.cloud.google.com/apis/credentials
  5. Log the rotation to pipeline_runs (phase='rotation').
Re-running is idempotent: prompt=consent always mints a fresh token; swap
the secret atomically between cron fires.`;

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

async function exchangeCode(
  clientId: string,
  clientSecret: string,
  code: string,
): Promise<{ refreshToken: string; grantedScopes: string[] }> {
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
  const json = (await resp.json()) as {
    refresh_token?: string;
    access_token?: string;
    scope?: string;
  };
  if (!json.refresh_token) {
    throw new Error('no refresh_token in token response (re-run; prompt=consent forces one)');
  }
  let grantedScopes = (json.scope ?? '').split(/\s+/).filter(Boolean);
  // Fallback: token responses normally carry `scope`; if absent, ask
  // tokeninfo with the (short-lived) access token. Never log either token.
  if (grantedScopes.length === 0 && json.access_token) {
    try {
      const info = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(json.access_token)}`,
      );
      if (info.ok) {
        const infoJson = (await info.json()) as { scope?: string };
        grantedScopes = (infoJson.scope ?? '').split(/\s+/).filter(Boolean);
      }
    } catch {
      // Non-fatal — scope verification degrades to a warning below.
    }
  }
  return { refreshToken: json.refresh_token, grantedScopes };
}

/** Required scopes absent from the granted set (empty = all good). */
function missingScopes(granted: string[]): string[] {
  const have = new Set(granted);
  return REQUIRED_SCOPES.filter((s) => !have.has(s));
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
      console.log('\nScopes (locked union):');
      for (const s of REQUIRED_SCOPES) console.log(`  ${s}`);
    }
    return;
  }

  if (args.dryRun) {
    log(STAGE, 'dry-run: would exchange code + write refresh token (skipped)');
    return;
  }

  // Step 2 — exchange the code for a refresh token.
  const { refreshToken, grantedScopes } = await exchangeCode(
    oauth.clientId,
    oauth.clientSecret,
    code,
  );
  const outPath = resolve(process.cwd(), SECRET_PATH);
  mkdirSync(resolve(process.cwd(), '.secrets'), { recursive: true });
  writeFileSync(outPath, `${refreshToken}\n`, { mode: 0o600 });

  // NEVER print the token. Only the path + the gh command. Scope names are
  // not secrets — print exactly what was GRANTED and warn if short.
  log(STAGE, 'refresh token written (not printed)', { path: SECRET_PATH });
  const missing = missingScopes(grantedScopes);
  if (grantedScopes.length === 0) {
    console.error(
      `[youtube:${STAGE}] WARNING: could not determine granted scopes (no scope in token response or tokeninfo). Verify manually before rotating the secret: the token must cover ${REQUIRED_SCOPES.join(', ')}`,
    );
  } else {
    console.log('\nGranted scopes:');
    for (const s of grantedScopes) {
      const required = (REQUIRED_SCOPES as readonly string[]).includes(s);
      console.log(`  ${required ? '✓' : '·'} ${s}`);
    }
  }
  if (missing.length > 0 && grantedScopes.length > 0) {
    console.error('');
    console.error(`[youtube:${STAGE}] ${'!'.repeat(70)}`);
    console.error(
      `[youtube:${STAGE}] WARNING: token is MISSING ${missing.length} required scope(s):`,
    );
    for (const s of missing) console.error(`[youtube:${STAGE}]   MISSING: ${s}`);
    console.error(
      `[youtube:${STAGE}] Cron B (upload), Cron E (analytics sync) and/or videos.update`,
    );
    console.error(
      `[youtube:${STAGE}] (revisit/supersede/seo) will fail 403 with this token. Re-run the`,
    );
    console.error(
      `[youtube:${STAGE}] consent flow and approve ALL requested scopes before rotating the secret.`,
    );
    console.error(`[youtube:${STAGE}] ${'!'.repeat(70)}`);
  }
  console.log(`\nNext: gh secret set YT_REFRESH_TOKEN < ${SECRET_PATH}`);
  console.log('Then revoke any prior token at https://console.cloud.google.com/apis/credentials');
  if (args.json) {
    console.log(
      JSON.stringify({
        step: 'exchanged',
        wrote: SECRET_PATH,
        grantedScopes,
        missingScopes: missing,
        ghCommand: `gh secret set YT_REFRESH_TOKEN < ${SECRET_PATH}`,
      }),
    );
  }
}

main().catch((e) => {
  logError(STAGE, e);
  process.exit(1);
});
