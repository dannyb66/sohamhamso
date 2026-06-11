/**
 * pipeline/youtube/secrets.ts
 *
 * Single chokepoint for every secret the YouTube pipeline reads from the
 * environment. NO OTHER FILE may read GOOGLE_TTS_*, GOOGLE_APPLICATION_*,
 * YOUTUBE_OAUTH_*, YT_REFRESH_TOKEN, or the R2/AWS_* vars directly.
 *
 * Fail-fast contract:
 *   - In prod (NODE_ENV==='production' || CI): hard-throw if a required
 *     secret is absent, so a misconfigured run aborts loudly.
 *   - In dev with MOCK_ALL==='true': return empty/placeholder values
 *     without throwing, so the zero-secret mock path (D1, TTHW <10min)
 *     works for a fresh contributor.
 *   - Plain local dev (neither prod nor MOCK_ALL): missing secrets return
 *     as undefined/empty — the caller decides whether that's fatal.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Environment mode helpers
// ─────────────────────────────────────────────────────────────────────────────

function isProd(): boolean {
  return process.env.NODE_ENV === 'production' || Boolean(process.env.CI);
}

function isMockAll(): boolean {
  return process.env.MOCK_ALL === 'true';
}

/**
 * Enforce the prod/mock contract for a group of secrets.
 * Returns true if the caller should short-circuit to mock (empty) values.
 * Throws in prod when any required value is missing.
 */
function guard(group: string, present: boolean): boolean {
  if (isMockAll()) return true; // mock path: never throw, caller returns empties
  if (isProd() && !present) {
    throw new Error(
      `[youtube:secrets] missing required ${group} credentials in production/CI. Set the relevant env vars (see .env.example) or run with MOCK_ALL=true in dev.`,
    );
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Google Cloud TTS
// ─────────────────────────────────────────────────────────────────────────────

export type GoogleTtsCreds = {
  /** Inline service-account JSON (GOOGLE_TTS_CREDENTIALS_JSON). */
  credentialsJson?: string;
  /** Path to ADC file (GOOGLE_APPLICATION_CREDENTIALS) or an API key. */
  apiKey?: string;
};

/**
 * Resolve Google Cloud TTS credentials. Prefers inline JSON, then the
 * ADC credentials path / API key.
 */
export function getGoogleTtsCreds(): GoogleTtsCreds {
  const credentialsJson = process.env.GOOGLE_TTS_CREDENTIALS_JSON;
  const apiKey = process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_TTS_API_KEY;
  const present = Boolean(credentialsJson || apiKey);
  if (guard('Google TTS', present)) return {};
  return { credentialsJson, apiKey };
}

// ─────────────────────────────────────────────────────────────────────────────
// YouTube OAuth (scope youtube.upload only, per E5)
// ─────────────────────────────────────────────────────────────────────────────

export function getYoutubeOAuth(): {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
} {
  const clientId = process.env.YOUTUBE_OAUTH_CLIENT_ID ?? '';
  const clientSecret = process.env.YOUTUBE_OAUTH_CLIENT_SECRET ?? '';
  const refreshToken = process.env.YT_REFRESH_TOKEN ?? '';
  const present = Boolean(clientId && clientSecret && refreshToken);
  if (guard('YouTube OAuth', present)) {
    return { clientId: '', clientSecret: '', refreshToken: '' };
  }
  return { clientId, clientSecret, refreshToken };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cloudflare R2 (S3-compatible, via AWS_* env per turso-backup pattern)
// ─────────────────────────────────────────────────────────────────────────────

export function getR2Creds(): {
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
} {
  const bucket = process.env.R2_BUCKET || 'sohamhamso-backups';
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID ?? '';
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY ?? '';
  const endpoint = process.env.AWS_ENDPOINT_URL ?? '';
  // bucket always has a default; the credential pair + endpoint are the
  // required secrets.
  const present = Boolean(accessKeyId && secretAccessKey && endpoint);
  if (guard('R2', present)) {
    return { bucket, accessKeyId: '', secretAccessKey: '', endpoint: '' };
  }
  return { bucket, accessKeyId, secretAccessKey, endpoint };
}
