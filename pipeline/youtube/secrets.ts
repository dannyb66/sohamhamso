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
// Azure Speech (REST) — or-IN / as-IN narration
// ─────────────────────────────────────────────────────────────────────────────

export type AzureTtsCreds = {
  /** Subscription key (AZURE_SPEECH_KEY) for Ocp-Apim-Subscription-Key. */
  key: string;
  /** Resource region short-name, e.g. "eastus" (AZURE_SPEECH_REGION). */
  region: string;
};

/**
 * Resolve Azure Speech credentials. Mirrors `getGoogleTtsCreds`: hard-fails in
 * prod/CI when an azure-provider voice needs them but they're absent; MOCK_ALL
 * bypasses (returns empties — the canned-WAV path never calls Azure).
 *
 * Region defaults to "eastus" only as a last resort; prod MUST set
 * AZURE_SPEECH_REGION to match the resource (a wrong region 401s/404s).
 */
export function getAzureTtsCreds(): AzureTtsCreds {
  const key = process.env.AZURE_SPEECH_KEY ?? '';
  const region = process.env.AZURE_SPEECH_REGION ?? '';
  // Both the key AND an explicit region are required (region is part of the
  // endpoint host; the eastus fallback is dev-only convenience).
  const present = Boolean(key && region);
  if (guard('Azure Speech', present)) return { key: '', region: '' };
  return { key, region: region || 'eastus' };
}

// ─────────────────────────────────────────────────────────────────────────────
// YouTube OAuth (scope youtube.upload only, per E5)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve a channel's refresh token. With per-language channels each channel
 * has its own token in `YT_REFRESH_TOKEN_<LANG>` (uppercase); falls back to the
 * legacy single `YT_REFRESH_TOKEN` (so a partial rollout / single-channel setup
 * keeps working). The OAuth client id/secret are shared across all channels
 * (one OAuth app, consented separately per brand-account channel).
 */
function resolveRefreshToken(lang?: string): string {
  if (lang) {
    const perLang = process.env[`YT_REFRESH_TOKEN_${lang.toUpperCase()}`];
    if (perLang) return perLang;
  }
  return process.env.YT_REFRESH_TOKEN ?? '';
}

export function getYoutubeOAuth(lang?: string): {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
} {
  const clientId = process.env.YOUTUBE_OAUTH_CLIENT_ID ?? '';
  const clientSecret = process.env.YOUTUBE_OAUTH_CLIENT_SECRET ?? '';
  const refreshToken = resolveRefreshToken(lang);
  const present = Boolean(clientId && clientSecret && refreshToken);
  // The failure label names the channel so the operator knows which token to mint/rotate.
  if (guard(`YouTube OAuth${lang ? ` (${lang} channel)` : ''}`, present)) {
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
