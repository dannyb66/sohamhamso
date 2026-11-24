/**
 * POST /api/donate/intent: create a Stripe PaymentIntent for the embedded
 * /donate checkout (deferred-intent flow: the browser collects payment
 * details first, then asks for a client secret and confirms).
 *
 * The server recomputes the charged amount from the base gift + cover-fees
 * flag with the same function the browser uses, so the client never
 * dictates the final amount.
 *
 * Abuse controls: same-origin only, amount bounds, Stripe Radar, plus the
 * Cloudflare rate-limit rule documented in docs/DONATIONS.md.
 */
import type { APIRoute } from 'astro';
import {
  checkBaseMinor,
  cleanLedgerName,
  cleanSource,
  donationTotalMinor,
  isDonateCurrency,
} from '../../../lib/donate/amounts';
import { donateBounds, upiEnabled } from '../../../lib/donate/config';
import { StripeApiError, createDonationIntent } from '../../../lib/donate/stripe';

export const prerender = false;

type DonateEnv = { STRIPE_SECRET_KEY?: string };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const IDEMPOTENCY_RE = /^[A-Za-z0-9-]{16,64}$/;

export const POST: APIRoute = async ({ request, locals }) => {
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin) {
    return json({ ok: false, message: 'Forbidden.' }, 403);
  }

  const env = (locals as { runtime?: { env?: DonateEnv } } | undefined)?.runtime?.env;
  const secretKey = env?.STRIPE_SECRET_KEY ?? process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return json({ ok: false, message: 'Online giving is not set up yet.' }, 503);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, message: "Couldn't read the request. Try again." }, 400);
  }

  const currency = body.currency === undefined ? 'usd' : body.currency;
  if (!isDonateCurrency(currency) || (currency === 'inr' && !upiEnabled())) {
    return json({ ok: false, message: 'Unsupported currency.' }, 400);
  }
  const bounds = donateBounds(currency);
  const check = checkBaseMinor(body.baseCents, bounds.min, bounds.max, currency);
  if (!check.ok) return json({ ok: false, message: check.message }, 400);
  if (typeof body.idempotencyKey !== 'string' || !IDEMPOTENCY_RE.test(body.idempotencyKey)) {
    return json({ ok: false, message: 'Bad request.' }, 400);
  }
  const coverFees = body.coverFees === true;

  try {
    const intent = await createDonationIntent(secretKey, {
      amountCents: donationTotalMinor(check.cents, coverFees, currency),
      baseCents: check.cents,
      currency,
      coverFees,
      source: cleanSource(body.source),
      ledgerName: cleanLedgerName(body.ledgerName),
      idempotencyKey: body.idempotencyKey,
    });
    return json({ ok: true, clientSecret: intent.clientSecret });
  } catch (err) {
    console.error(
      '[donate-intent]',
      err instanceof StripeApiError ? `${err.status} ${err.code ?? ''} ${err.message}` : err,
    );
    // e.g. UPI not yet activated on the account: steer the donor to a working rail.
    const message =
      currency === 'inr'
        ? "UPI isn't available right now. Please try again later, or give by card in the other tab."
        : "We couldn't start the payment. Please try again.";
    return json({ ok: false, message }, 502);
  }
};

export const GET: APIRoute = () => json({ ok: false, message: 'Method Not Allowed' }, 405);
