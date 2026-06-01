/**
 * POST /api/subscribe — V1 stub for the daily-verse subscribe form.
 *
 * V1 BEHAVIOR (stub):
 *   - Validates email format.
 *   - Validates `language` against the locked language registry.
 *   - Returns {ok: true, message: "Check your inbox..."} on success.
 *   - Returns {ok: false, message} with appropriate status on error.
 *   - Does NOT send an email.
 *   - Does NOT write to the pii-DB (subscribers table).
 *
 * V1.x TODO (owned by the daily-verse curator workstream):
 *   1. HMAC-SHA256(email, SUBSCRIBER_HASH_PEPPER) → email_hash.
 *   2. Insert into `subscribers(email_hash, language, subscribed_at,
 *      unsubscribe_token, region)` — pii-DB (separate Turso DB per
 *      eng-review architecture).
 *   3. Send a double-opt-in confirmation email via Resend, region-
 *      pinned to EU or US per the user's request locale.
 *   4. Wire to Cloudflare Worker cron at sunrise per region.
 *   5. Feature-flag the actual send to prevent accidental empty-send
 *      spam during development.
 *
 * Reference: plan §"Daily verse engagement loop (V1 — English only)"
 * and the Eng Review locked decision on HMAC-SHA256 with per-deployment
 * pepper rotated yearly.
 */

import type { APIRoute } from "astro";

// Server-rendered endpoint — Astro's default `output: 'static'` would
// prerender this route and reject POST. The opt-out keeps the rest of
// the site static while letting this one route accept form submissions.
export const prerender = false;

// Languages active at V1 — English only. Others are queued but rejected
// for now with an honest "not yet available" message.
const ACTIVE_LANGUAGES = new Set(["en"]);
const KNOWN_LANGUAGES = new Set([
  "en", "hi", "ta", "te", "bn", "mr", "gu", "kn", "ml", "pa", "or", "as",
]);

// RFC 5322-flavored email regex — pragmatic, not exhaustive. Server
// stub only; the real Resend integration will do its own validation.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(init.headers || {}),
    },
  });
}

export const POST: APIRoute = async ({ request }) => {
  let email = "";
  let language = "en";

  // Accept both JSON (progressive-enhanced fetch) and form-encoded
  // (no-JS fallback) so the form keeps working with the script off.
  const contentType = request.headers.get("content-type") || "";
  try {
    if (contentType.includes("application/json")) {
      const body = await request.json();
      email = String(body?.email ?? "").trim();
      language = String(body?.language ?? "en").trim().toLowerCase();
    } else {
      const form = await request.formData();
      email = String(form.get("email") ?? "").trim();
      language = String(form.get("language") ?? "en").trim().toLowerCase();
    }
  } catch {
    return json(
      { ok: false, message: "Couldn't read the request. Try again." },
      { status: 400 },
    );
  }

  if (!email || !EMAIL_RE.test(email)) {
    return json(
      { ok: false, message: "Please enter a valid email address." },
      { status: 400 },
    );
  }

  if (!KNOWN_LANGUAGES.has(language)) {
    return json(
      { ok: false, message: "Unknown language." },
      { status: 400 },
    );
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

  // SUCCESS — V1 stub. No email is actually sent, no row is written.
  // The V1.x daily-verse curator workstream replaces this stub with
  // the full HMAC-hash + subscribers-DB insert + Resend send.
  return json({
    ok: true,
    message: "Check your inbox to confirm — link expires in 24h.",
  });
};

// Reject other methods explicitly so the route is honest about its
// surface area.
export const GET: APIRoute = () =>
  json({ ok: false, message: "POST only." }, { status: 405, headers: { Allow: "POST" } });
