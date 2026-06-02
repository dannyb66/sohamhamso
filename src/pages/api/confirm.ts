/**
 * GET /api/confirm?token={unsubscribe_token} — double-opt-in confirmation.
 *
 * BEHAVIOR:
 *   - Parse `token` from the query string.
 *   - Validate token shape (32 base64url chars per the existing
 *     `generateUnsubscribeToken()` in subscribe.ts). Malformed tokens
 *     redirect to `/confirmed?error=unknown` — NEVER 404. A 404 would
 *     leak signal ("this token doesn't exist"); enumeration defense
 *     demands the same response for both "no row" and "bad shape".
 *   - Call `getSubscriberConfirm()` → `confirmByToken(token)`.
 *   - On `status: 'confirmed'` → 302 redirect to `/confirmed`.
 *   - On `status: 'unknown'` → 302 redirect to `/confirmed?error=unknown`
 *     (still a 200-ish landing page; the `?error` lets the page render
 *     a quieter, non-celebratory copy without revealing whether the
 *     token was malformed vs. unknown vs. expired).
 *   - Idempotent: re-confirming an already-confirmed row succeeds.
 *
 * METHOD:
 *   GET only. The link arrives in the user's inbox; clicking it must
 *   not require JavaScript or a POST. POST/PUT/DELETE all 405.
 *
 * SAFETY:
 *   - No CSRF token check — the action is idempotent, the token IS
 *     the secret, and email-link CSRF (a stolen click) only causes a
 *     confirm-that-was-already-going-to-happen.
 *   - Cache-Control: no-store. The token must never land in a CDN.
 *
 * Reference: deployment plan §"Code work" step 9 (double-opt-in via
 * Resend) and the `/about/privacy` promise that confirms + unsubscribes
 * happen by clicking a link, not by submitting a form.
 */

import type { APIRoute } from 'astro';
import { TOKEN_RE, getSubscriberConfirm } from '../../lib/subscriber-confirm';

export const prerender = false;

function redirect(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      // Confirmation links MUST NOT hit any cache — token-in-URL.
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}

export const GET: APIRoute = async ({ url }) => {
  const token = (url.searchParams.get('token') ?? '').trim();

  // Enumeration defense: redirect (not 404) for both malformed and
  // unknown tokens. The `error=unknown` param lets the landing page
  // render quietly without revealing which case fired.
  if (!token || !TOKEN_RE.test(token)) {
    return redirect('/confirmed?error=unknown');
  }

  let result: { status: 'confirmed' | 'unknown' };
  try {
    const confirm = await getSubscriberConfirm();
    result = await confirm.confirmByToken(token);
  } catch (err) {
    // Operator-facing trace — surfaces in CF Workers logs.
    console.error('[confirm] DB error', err);
    // Fail safe: redirect to the error landing page rather than
    // surfacing the internals to the user.
    return redirect('/confirmed?error=server');
  }

  if (result.status === 'unknown') {
    return redirect('/confirmed?error=unknown');
  }
  return redirect('/confirmed');
};

// All other methods 405 — the link in the inbox must work with a plain
// browser GET; nothing else is a legitimate caller.
function methodNotAllowed(): Response {
  return new Response(JSON.stringify({ ok: false, message: 'GET only.' }), {
    status: 405,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Allow: 'GET',
    },
  });
}

export const POST: APIRoute = () => methodNotAllowed();
export const PUT: APIRoute = () => methodNotAllowed();
export const DELETE: APIRoute = () => methodNotAllowed();
