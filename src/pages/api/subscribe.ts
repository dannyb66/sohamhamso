/**
 * POST /api/subscribe — daily-verse subscribe endpoint.
 *
 * V1.0 BEHAVIOR (this file):
 *   - Validates email shape + language against the locked registry.
 *   - HMAC-SHA256(email, SUBSCRIBER_HASH_PEPPER) → email_hash.
 *   - Generates a 32-char URL-safe unsubscribe_token (crypto.randomBytes(24)
 *     → base64url, length 32).
 *   - Region: derived from the `cf-ipcountry` header (EU-27 → "eu",
 *     otherwise "us"). Default "us" when the header is absent.
 *   - Inserts into the D1-backed `subscribers` table with confirmation
 *     pending, retaining HMAC, encrypted, and temporary plaintext delivery
 *     fields during mailer stabilization.
 *   - Sends the double-opt-in confirmation through the Resend adapter.
 *   - Idempotent on (email_hash, language) — re-subscribes reuse the original
 *     confirmation token and return a friendly 200 response.
 *
 * Reference: plan §"Daily verse engagement loop" and the Eng Review
 * locked decision on HMAC-SHA256 with per-deployment pepper.
 */

import { createHmac, randomBytes } from 'node:crypto';
import type { APIRoute } from 'astro';
import {
  type D1Database,
  SubscriberUniqueViolation,
  getSubscriberDb,
  isEdgeRuntime,
} from '../../lib/subscriber-db';
import {
  type SubscriberEmailEnv,
  assertEmailDeliveryConfigured,
  encryptSubscriberEmail,
  sendSubscriberConfirmation,
} from '../../lib/subscriber-email';

// Server-rendered endpoint — Astro's default `output: 'static'` would
// prerender this route and reject POST. The opt-out keeps the rest of
// the site static while letting this one route accept form submissions.
export const prerender = false;

// Languages active at V1 — English only. Others are queued but rejected
// for now with an honest "not yet available" message. Source of truth
// lives in src/lib/subscribe-langs.ts so the SubscribeBand picker stays
// in sync — out-of-sync state lands real users on a dead-end submit.
import { ACTIVE_LANGUAGES, KNOWN_LANGUAGES } from '../../lib/subscribe-langs';

// RFC 5322-flavored email regex — pragmatic, not exhaustive. Server
// Pragmatic server-side validation; the provider performs final validation.
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
// runtime guard below throws a 500 if it leaks through at the edge.
const DEV_PEPPER = 'dev-pepper-CHANGE-IN-PROD';

/**
 * Thrown when the SUBSCRIBER_HASH_PEPPER env var is missing or equals
 * the dev fallback AT THE EDGE. Surfaced to the operator as a 500 with
 * an explicit "server misconfigured" message rather than silently
 * shipping with the dev pepper (which would let an attacker enumerate
 * subscriber emails post-breach, because HMAC keys derived from a
 * publicly-known pepper are functionally not secret).
 */
export class PepperNotConfiguredError extends Error {
  constructor() {
    super(
      'Server misconfigured: SUBSCRIBER_HASH_PEPPER is not set (or is the dev default) in a production runtime. ' +
        'Set a 32+ char random string as a Cloudflare Pages secret: ' +
        '`wrangler pages secret put SUBSCRIBER_HASH_PEPPER --project sohamhamso`.',
    );
    this.name = 'PepperNotConfiguredError';
  }
}

let _pepperWarned = false;
function loadPepper(boundValue?: string): string {
  const env = boundValue ?? process.env.SUBSCRIBER_HASH_PEPPER;
  const edge = isEdgeRuntime();

  // Edge: HARD ERROR if unset or stuck on the dev default. The previous
  // behavior — a one-line `console.warn` — was a footgun: the operator
  // would never see the warning in Workers logs until after the breach.
  if (edge) {
    if (!env || env.length === 0 || env === DEV_PEPPER) {
      throw new PepperNotConfiguredError();
    }
    return env;
  }

  // Dev / bun runtime: keep the lenient fallback so the local dev loop
  // doesn't require any env wiring. One-time warn so the operator still
  // hears the nudge before they ship.
  if (env && env.length > 0) {
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

export const POST: APIRoute = async ({ request, locals }) => {
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

  const env = (
    locals as
      | {
          runtime?: {
            env?: { PII_DB?: D1Database; SUBSCRIBER_HASH_PEPPER?: string } & SubscriberEmailEnv;
          };
        }
      | undefined
  )?.runtime?.env;
  const edge = isEdgeRuntime();
  let pepper: string;
  let encryptedEmail: { ciphertext: string; nonce: string };
  try {
    pepper = loadPepper(env?.SUBSCRIBER_HASH_PEPPER);
    assertEmailDeliveryConfigured(env ?? {}, edge);
    encryptedEmail = await encryptSubscriberEmail(email, env?.SUBSCRIBER_EMAIL_KEY, edge);
  } catch (err) {
    // biome-ignore lint/suspicious/noConsole: operator-facing configuration error
    console.error('[subscribe]', err instanceof Error ? err.message : err);
    return json(
      { ok: false, message: 'Server misconfigured. Please contact the operator.' },
      { status: 500 },
    );
  }
  const email_hash = hashEmail(email, pepper);
  const unsubscribe_token = generateUnsubscribeToken();
  const region = regionForRequest(request.headers);
  const subscribed_at = new Date().toISOString();

  const db = await getSubscriberDb(env);
  let confirmationToken = unsubscribe_token;
  let alreadyConfirmed = false;
  try {
    await db.insertSubscriber({
      email_hash,
      email: email.toLowerCase().trim(),
      email_ciphertext: encryptedEmail.ciphertext,
      email_nonce: encryptedEmail.nonce,
      language,
      subscribed_at,
      unsubscribe_token,
      region,
    });
  } catch (err) {
    if (err instanceof SubscriberUniqueViolation) {
      const existing = await db.findSubscriber?.(email_hash, language);
      if (existing) {
        confirmationToken = existing.unsubscribe_token;
        alreadyConfirmed = existing.confirmed;
      }
    } else {
      // biome-ignore lint/suspicious/noConsole: server-side error trace
      console.error('[subscribe] insert failed', err);
      return json(
        { ok: false, message: 'Something went wrong on our end. Try again in a moment.' },
        { status: 500 },
      );
    }
  }

  if (!alreadyConfirmed) {
    let sent = false;
    try {
      sent = await sendSubscriberConfirmation({
        email,
        language,
        token: confirmationToken,
        baseUrl: new URL(request.url).origin,
        env: env ?? {},
        requireConfigured: edge,
      });
      await db.markConfirmationDelivery?.(confirmationToken, sent);
    } catch (error) {
      await db.markConfirmationDelivery?.(confirmationToken, false).catch(() => {});
      // biome-ignore lint/suspicious/noConsole: operator-facing delivery trace
      console.error('[subscribe] confirmation delivery failed', error);
    }
    if (!sent && edge) {
      return json(
        { ok: false, message: 'We saved your request but could not send confirmation. Try again.' },
        { status: 502 },
      );
    }
  }

  return json({
    ok: true,
    message: alreadyConfirmed
      ? "You're already confirmed. The next verse arrives at sunrise."
      : "You're subscribed pending confirmation. Check your inbox; after confirmation, the first verse arrives at sunrise.",
  });
};

// Reject other methods explicitly so the route is honest about its
// surface area.
export const GET: APIRoute = () =>
  json({ ok: false, message: 'POST only.' }, { status: 405, headers: { Allow: 'POST' } });
