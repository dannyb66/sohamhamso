/**
 * pipeline/youtube/log.ts
 *
 * Structured logging + secret/PII redaction for the YouTube pipeline.
 * Matches the `[stage]` log convention used by pipeline/embed/runner.ts.
 *
 * `scrubError` (E6) is the single redaction chokepoint: EVERY value
 * written to `videos.last_error` / `pipeline_runs.error_msg` must pass
 * through it first, so no service-account path, AWS/R2 key, OAuth token,
 * or long run of translation text (Indic script) is ever persisted.
 * Enforced by pipeline-run-redaction.test.ts.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Structured logging
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Emit a structured line: `[youtube:<stage>] msg key=val key=val`.
 * Field values are JSON-encoded when not primitive strings so objects
 * stay on one line.
 */
export function log(stage: string, msg: string, fields?: Record<string, unknown>): void {
  let line = `[youtube:${stage}] ${msg}`;
  if (fields) {
    for (const [k, v] of Object.entries(fields)) {
      line += ` ${k}=${formatFieldValue(v)}`;
    }
  }
  // eslint-disable-next-line no-console
  console.log(line);
}

function formatFieldValue(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (typeof v === 'string') {
    // Quote strings that contain whitespace so key=val stays parseable.
    return /\s/.test(v) ? JSON.stringify(v) : v;
  }
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') {
    return String(v);
  }
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Redaction (E6)
// ─────────────────────────────────────────────────────────────────────────────

const REDACTED = '[redacted]';

// Order matters: token patterns before the generic Indic sweep.
const REDACTION_PATTERNS: RegExp[] = [
  // Google service-account identity / paths
  /[A-Za-z0-9_-]+\.iam\.gserviceaccount\.com/g,
  // AWS / R2 access key id
  /AKIA[A-Z0-9]{16}/g,
  // Google OAuth access tokens (ya29.<payload>) and refresh tokens (1//...).
  // ya29 tokens carry a literal dot before the payload; allow an optional
  // separator so the {30,} payload run is still captured.
  /(?:ya29\.?|1\/\/)[A-Za-z0-9_-]{30,}/g,
  // Runs of 30+ Indic-script chars — translation-text leak prevention.
  // Covers Devanagari, Bengali/Assamese, Gurmukhi, Gujarati, Oriya,
  // Tamil, Telugu, Kannada, Malayalam unicode blocks.
  /[ऀ-ॿঀ-৿਀-੿઀-૿଀-୿஀-௿ఀ-౿ಀ-೿ഀ-ൿ]{30,}/g,
];

/**
 * Return a redacted string safe to persist or log. Accepts Error objects
 * (uses stack ?? message), strings, or anything else (String()-coerced).
 * Strips service-account paths, AWS keys, OAuth tokens, and 30+-char
 * Indic-script substrings.
 */
export function scrubError(input: unknown): string {
  let s: string;
  if (input instanceof Error) {
    s = input.stack ?? input.message ?? String(input);
  } else if (typeof input === 'string') {
    s = input;
  } else if (input === null) {
    s = 'null';
  } else if (input === undefined) {
    s = 'undefined';
  } else {
    try {
      s = JSON.stringify(input);
    } catch {
      s = String(input);
    }
  }
  for (const re of REDACTION_PATTERNS) {
    s = s.replace(re, REDACTED);
  }
  return s;
}

/**
 * Log a scrubbed error to stderr. NEVER log a raw error in pipeline
 * scripts — always route through here so secrets/translation text are
 * stripped first.
 */
export function logError(stage: string, err: unknown): void {
  // eslint-disable-next-line no-console
  console.error(`[youtube:${stage}] error: ${scrubError(err)}`);
}
