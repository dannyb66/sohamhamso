/**
 * GET /api/unsubscribe?token={unsubscribe_token} — one-click unsubscribe.
 *
 * BEHAVIOR:
 *   - Parse `token` from the query string.
 *   - Validate token shape (32 base64url chars per the existing
 *     `generateUnsubscribeToken()` in subscribe.ts). Malformed tokens
 *     redirect to `/unsubscribed` (NO `?error=` param) so the response
 *     is byte-for-byte identical to a successful unsubscribe —
 *     enumeration defense at its strictest.
 *   - Call `getSubscriberConfirm()` → `deleteByToken(token)`. The row
 *     is removed entirely (not soft-deleted) so `/about/privacy`'s
 *     promise ("Following it deletes your row from the subscribers
 *     database.") is literally true.
 *   - Redirect to `/unsubscribed` regardless of `{deleted: true|false}`.
 *     A "no such row" response would leak the (token, no-row) signal
 *     to anyone scanning for valid tokens — same threat model as the
 *     confirm endpoint.
 *
 * METHOD:
 *   GET only. Email clients (and CASL/CAN-SPAM/RFC 8058 one-click
 *   unsubscribe headers) expect the link to be GET-clickable. Other
 *   verbs return 405.
 *
 * SAFETY:
 *   - No CSRF — token IS the secret; a stolen click only unsubscribes
 *     a user who was about to want that anyway.
 *   - Cache-Control: no-store. Token must never reach a CDN.
 *
 * Reference: `/about/privacy` (delete-on-click promise) + deployment
 * plan §"Code work" step 9 (re-uses the unsubscribe_token column for
 * both confirm + unsubscribe; intent is disambiguated by route).
 */

import type { APIRoute } from 'astro';
import { TOKEN_RE, getSubscriberConfirm } from '../../lib/subscriber-confirm';

export const prerender = false;

function redirect(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      // Tokens must not be cached anywhere.
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}

export const GET: APIRoute = async ({ url }) => {
  const token = (url.searchParams.get('token') ?? '').trim();

  // Strict enumeration defense: bad-shape tokens get the SAME
  // /unsubscribed landing as a real unsubscribe. No `?error=`, no 404.
  // The user-facing copy ("If you weren't subscribed, no action was
  // needed") absorbs both cases gracefully.
  if (!token || !TOKEN_RE.test(token)) {
    return redirect('/unsubscribed');
  }

  try {
    const confirm = await getSubscriberConfirm();
    // We intentionally don't act on the `{deleted}` return value —
    // either case yields the same landing page. The boolean is
    // observable to the DB layer (and to tests) for diagnostic
    // purposes only.
    await confirm.deleteByToken(token);
  } catch (err) {
    // Operator-facing trace — surfaces in CF Workers logs. We still
    // redirect to the same /unsubscribed page so a transient DB
    // failure looks identical to a success at the user surface; the
    // operator sees the error in logs and can re-run the cron.
    console.error('[unsubscribe] DB error', err);
  }

  return redirect('/unsubscribed');
};

// All other methods 405.
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
