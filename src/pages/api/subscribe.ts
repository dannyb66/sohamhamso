/**
 * POST /api/subscribe — daily-verse subscribe endpoint (V1.0).
 *
 * V1.0 BEHAVIOR (this file):
 *   - Validates email shape + language against the locked registry.
 *   - HMAC-SHA256(email, SUBSCRIBER_HASH_PEPPER) → email_hash.
 *   - Generates a 32-char URL-safe unsubscribe_token (crypto.randomBytes(24)
 *     → base64url, length 32).
 *   - Region: derived from the `cf-ipcountry` header (EU-27 → "eu",
 *     otherwise "us"). Default "us" when the header is absent.
 *   - Inserts into the local `subscribers` table with confirmed_at left
 *     null. Idempotent on (email_hash, language) — re-subscribes return
 *     200 with the same friendly message, no error.
 *   - Returns {ok: true, message: "Check your inbox to confirm"} on
 *     success. The "inbox" copy is forward-compatible with V1.x when
 *     the Worker actually sends the confirmation email.
 *
 * V1.x TODO (owned by the daily-verse curator workstream):
 *   1. Double opt-in: a Cloudflare Worker reads recently-subscribed rows
 *      and sends a confirmation email via Resend; the confirm endpoint
 *      sets `confirmed_at`.
 *   2. Send the verse-of-the-day at sunrise per region.
 *   3. Move writes to the pii Turso DB (separate from corpus per eng
 *      review). The local-dev path stays the single SQLite file.
 *
 * Reference: plan §"Daily verse engagement loop" and the Eng Review
 * locked decision on HMAC-SHA256 with per-deployment pepper.
 */

import { createHmac, randomBytes } from 'node:crypto';
import type { APIRoute } from 'astro';
import { getWritableDb } from '../../lib/db';

// Server-rendered endpoint — Astro's default `output: 'static'` would
// prerender this route and reject POST. The opt-out keeps the rest of
// the site static while letting this one route accept form submissions.
export const prerender = false;

// Languages active at V1 — English only. Others are queued but rejected
// for now with an honest "not yet available" message.
const ACTIVE_LANGUAGES = new Set(['en']);
const KNOWN_LANGUAGES = new Set([
  'en',
  'hi',
  'ta',
  'te',
  'bn',
  'mr',
  'gu',
  'kn',
  'ml',
  'pa',
  'or',
  'as',
]);

// RFC 5322-flavored email regex — pragmatic, not exhaustive. Server
// stub only; the real Resend integration will do its own validation.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// EU-27 ISO-3166 alpha-2 codes. UK (GB) is intentionally NOT in this set
// (no longer EU). Used to pick the "eu" region slot from the
// `cf-ipcountry` request header. Anything outside this set falls back
// to "us" — the safer default for a US-pinned send service.
const EU_COUNTRIES = new Set([
  'AT',
  'BE',
  'BG',
  'HR',
  'CY',
  'CZ',
  'DK',
  'EE',
  'FI',
  'FR',
  'DE',
  'GR',
  'HU',
  'IE',
  'IT',
  'LV',
  'LT',
  'LU',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SK',
  'SI',
  'ES',
  'SE',
]);

// Dev-only pepper fallback. NEVER use this value in production — the
// runtime guard below warns once if it leaks through with NODE_ENV=production.
const DEV_PEPPER = 'dev-pepper-CHANGE-IN-PROD';

let _pepperWarned = false;
function loadPepper(): string {
  const env = process.env.SUBSCRIBER_HASH_PEPPER;
  if (env && env.length > 0) {
    // Guard against the dev default being copy-pasted into a prod env.
    if (env === DEV_PEPPER && process.env.NODE_ENV === 'production') {
      if (!_pepperWarned) {
        // biome-ignore lint/suspicious/noConsole: intentional one-time
        // operator warning at module load
        console.warn(
          '[subscribe] SUBSCRIBER_HASH_PEPPER is set to the dev default in production — rotate immediately.',
        );
        _pepperWarned = true;
      }
    }
    return env;
  }
  if (!_pepperWarned) {
    // biome-ignore lint/suspicious/noConsole: one-time dev warning
    console.warn(
      '[subscribe] SUBSCRIBER_HASH_PEPPER not set — falling back to dev pepper. DO NOT deploy without setting this.',
    );
    _pepperWarned = true;
  }
  return DEV_PEPPER;
}

/**
 * HMAC-SHA256(email, pepper) → hex digest. Email is lowercased + trimmed
 * before hashing so two casings of the same address collapse to one row.
 *
 * Exported for unit-test verification of determinism / pepper sensitivity.
 */
export function hashEmail(email: string, pepper: string): string {
  return createHmac('sha256', pepper).update(email.toLowerCase().trim()).digest('hex');
}

/**
 * 32-char URL-safe unsubscribe token. `randomBytes(24)` → 24 bytes →
 * 32 base64url chars (no padding). Long enough to be unguessable; short
 * enough to fit comfortably in an unsubscribe URL.
 */
function generateUnsubscribeToken(): string {
  return randomBytes(24).toString('base64url');
}

/**
 * Resolve the region slot ("us"|"eu") for a request. Reads the
 * `cf-ipcountry` header that Cloudflare injects on its edge — anything
 * in the EU-27 set maps to "eu"; everything else (including no header,
 * "XX" / "T1" sentinels, and non-EU countries) falls back to "us".
 *
 * Exported for unit-test coverage.
 */
export function regionForRequest(headers: Headers): 'us' | 'eu' {
  const cc = (headers.get('cf-ipcountry') ?? '').trim().toUpperCase();
  if (cc && EU_COUNTRIES.has(cc)) return 'eu';
  return 'us';
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...(init.headers || {}),
    },
  });
}

// `bun:sqlite` SQLiteError shape — we only need the code field.
function isUniqueViolation(err: unknown): boolean {
  if (err == null || typeof err !== 'object') return false;
  const e = err as { code?: unknown; message?: unknown };
  if (typeof e.code === 'string' && e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    return true;
  }
  // Fallback for drivers/wrappers that surface the constraint name via
  // message rather than code (defensive — base path uses .code above).
  if (typeof e.message === 'string' && /UNIQUE constraint failed/i.test(e.message)) {
    return true;
  }
  return false;
}

export const POST: APIRoute = async ({ request }) => {
  let email = '';
  let language = 'en';

  // Accept both JSON (progressive-enhanced fetch) and form-encoded
  // (no-JS fallback) so the form keeps working with the script off.
  const contentType = request.headers.get('content-type') || '';
  try {
    if (contentType.includes('application/json')) {
      const body = await request.json();
      email = String(body?.email ?? '').trim();
      language = String(body?.language ?? 'en')
        .trim()
        .toLowerCase();
    } else {
      const form = await request.formData();
      email = String(form.get('email') ?? '').trim();
      language = String(form.get('language') ?? 'en')
        .trim()
        .toLowerCase();
    }
  } catch {
    return json({ ok: false, message: "Couldn't read the request. Try again." }, { status: 400 });
  }

  if (!email || !EMAIL_RE.test(email)) {
    return json({ ok: false, message: 'Please enter a valid email address.' }, { status: 400 });
  }

  if (!KNOWN_LANGUAGES.has(language)) {
    return json({ ok: false, message: 'Unknown language.' }, { status: 400 });
  }

  if (!ACTIVE_LANGUAGES.has(language)) {
    return json(
      {
        ok: false,
        message:
          "That language isn't available yet. English is live at launch — more languages roll out as translations are reviewed.",
      },
      { status: 400 },
    );
  }

  const pepper = loadPepper();
  const email_hash = hashEmail(email, pepper);
  const unsubscribe_token = generateUnsubscribeToken();
  const region = regionForRequest(request.headers);
  const subscribed_at = new Date().toISOString();

  try {
    const db = getWritableDb();
    const stmt = db.prepare(`
      INSERT INTO subscribers
        (email_hash, language, subscribed_at, unsubscribe_token, region)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(email_hash, language, subscribed_at, unsubscribe_token, region);
  } catch (err) {
    if (isUniqueViolation(err)) {
      // Idempotent: same email + same language already subscribed.
      // Return success with the same copy — never leak the
      // already-subscribed signal (enumeration defense).
      return json({
        ok: true,
        message: 'Check your inbox to confirm — link expires in 24h.',
      });
    }
    // biome-ignore lint/suspicious/noConsole: server-side error trace
    console.error('[subscribe] insert failed', err);
    return json(
      { ok: false, message: 'Something went wrong on our end. Try again in a moment.' },
      { status: 500 },
    );
  }

  return json({
    ok: true,
    message: 'Check your inbox to confirm — link expires in 24h.',
  });
};

// Reject other methods explicitly so the route is honest about its
// surface area.
export const GET: APIRoute = () =>
  json({ ok: false, message: 'POST only.' }, { status: 405, headers: { Allow: 'POST' } });
