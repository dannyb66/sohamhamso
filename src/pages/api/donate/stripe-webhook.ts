/**
 * POST /api/donate/stripe-webhook: Stripe → public ledger.
 * Logic lives in src/lib/donate/ledger.ts (unit-tested without Astro).
 */
import type { APIRoute } from 'astro';
import { type LedgerEnv, handleStripeWebhook } from '../../../lib/donate/ledger';

export const prerender = false;

export const POST: APIRoute = ({ request, locals }) => {
  const env = (locals as { runtime?: { env?: LedgerEnv } } | undefined)?.runtime?.env ?? {};
  return handleStripeWebhook(request, {
    STRIPE_WEBHOOK_SECRET: env.STRIPE_WEBHOOK_SECRET ?? process.env.STRIPE_WEBHOOK_SECRET,
    LEDGER_DB: env.LEDGER_DB,
  });
};
