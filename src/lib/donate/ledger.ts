/**
 * Stripe webhook → public ledger (D1 `LEDGER_DB`, schema in migrations-ledger/).
 *
 * Events (Dashboard → Developers → Webhooks):
 *   payment_intent.succeeded      embedded /donate checkout (cards, wallets, Link, ACH)
 *   checkout.session.completed    hosted Payment Link fallback, if used
 *   charge.refunded               hides refunded gifts from the public view
 *
 * Privacy: a name is stored only when the donor typed one for the ledger.
 * Emails, PaymentIntent ids and bank details are never exposed publicly
 * (`external_ref` is excluded from the `ledger_public` view).
 *
 * Test-mode events (`livemode: false`, e.g. the sandbox webhook pointed at a
 * preview deployment) share the same database, so they are stored with an
 * `stripe-test:` id prefix and `is_public = 0`: visible to the operator,
 * never on the public ledger.
 */
import { cleanLedgerName, cleanSource } from './amounts';
import { verifyStripeSignature } from './stripe';

/** Minimal D1 surface used here (keeps tests free of Cloudflare types). */
export interface LedgerDb {
  prepare(sql: string): {
    bind(...values: unknown[]): { run(): Promise<{ meta: { changes: number } }> };
  };
}

export interface LedgerEnv {
  STRIPE_WEBHOOK_SECRET?: string;
  LEDGER_DB?: LedgerDb;
}

interface PaymentIntentObj {
  id: string;
  created: number;
  amount_received: number;
  currency: string;
  status: string;
  metadata?: Record<string, string>;
}

interface CheckoutSessionObj {
  id: string;
  created: number;
  amount_total: number | null;
  currency: string | null;
  payment_status: string;
  client_reference_id: string | null;
  payment_intent: string | null;
  custom_fields?: { key: string; text?: { value: string | null } | null }[];
}

interface ChargeObj {
  payment_intent: string | null;
  refunded: boolean;
}

const INSERT = `INSERT OR IGNORE INTO ledger_entries
  (id, occurred_at, rail, direction, kind, amount_minor, currency, source, display_name, memo, external_ref, is_public)
  VALUES (?1, ?2, 'stripe', 'in', 'donation', ?3, ?4, ?5, ?6, ?7, ?8, ?9)`;

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });

export async function handleStripeWebhook(request: Request, env: LedgerEnv): Promise<Response> {
  if (request.method !== 'POST') return text('Method Not Allowed', 405);
  // Raw body: re-serialised JSON would not match the signature.
  const raw = await request.text();
  if (
    !(await verifyStripeSignature(
      raw,
      request.headers.get('stripe-signature'),
      env.STRIPE_WEBHOOK_SECRET,
    ))
  ) {
    return text('Invalid signature', 400);
  }
  const db = env.LEDGER_DB;
  if (!db) {
    // Misconfigured: 500 so Stripe retries once the binding exists (retries span ~3 days).
    console.error('[donate-webhook] LEDGER_DB binding is missing');
    return text('Ledger not configured', 500);
  }

  let event: { id: string; type: string; livemode?: boolean; data: { object: unknown } };
  try {
    event = JSON.parse(raw);
  } catch {
    return text('Bad JSON', 400);
  }

  const seen = await db
    .prepare('INSERT OR IGNORE INTO stripe_events (event_id, type) VALUES (?1, ?2)')
    .bind(event.id, event.type)
    .run();
  if (seen.meta.changes === 0) return text('Already processed', 200);

  const live = event.livemode !== false;
  const idPrefix = live ? 'stripe' : 'stripe-test';
  const isPublic = live ? 1 : 0;
  const testMemo = (memo: string | null) => (live ? memo : memo ? `test · ${memo}` : 'test');

  try {
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const pi = event.data.object as PaymentIntentObj;
        if (pi.metadata?.kind !== 'donation' || !pi.amount_received) break;
        const covered = pi.metadata.cover_fees === 'yes';
        await db
          .prepare(INSERT)
          .bind(
            `${idPrefix}:${pi.id}`,
            new Date(pi.created * 1000).toISOString(),
            pi.amount_received,
            pi.currency.toUpperCase(),
            cleanSource(pi.metadata.source),
            cleanLedgerName(pi.metadata.ledger_name),
            testMemo(covered ? 'donor covered fees' : null),
            pi.id,
            isPublic,
          )
          .run();
        break;
      }
      case 'checkout.session.completed': {
        const s = event.data.object as CheckoutSessionObj;
        if (s.payment_status !== 'paid' || !s.amount_total || !s.currency || !s.payment_intent)
          break;
        const name = s.custom_fields?.find((f) => f.key === 'ledger_name')?.text?.value;
        await db
          .prepare(INSERT)
          .bind(
            `${idPrefix}:${s.payment_intent}`,
            new Date(s.created * 1000).toISOString(),
            s.amount_total,
            s.currency.toUpperCase(),
            cleanSource(s.client_reference_id),
            cleanLedgerName(name),
            testMemo(null),
            s.payment_intent,
            isPublic,
          )
          .run();
        break;
      }
      case 'charge.refunded': {
        const c = event.data.object as ChargeObj;
        if (c.payment_intent && c.refunded) {
          await db
            .prepare(
              `UPDATE ledger_entries SET is_public = 0, memo = 'refunded' WHERE rail = 'stripe' AND external_ref = ?1`,
            )
            .bind(c.payment_intent)
            .run();
        }
        break;
      }
      default:
        break; // acknowledge so Stripe stops retrying
    }
  } catch (err) {
    // Un-mark so Stripe's retry is processed.
    await db.prepare('DELETE FROM stripe_events WHERE event_id = ?1').bind(event.id).run();
    console.error('[donate-webhook] failed', event.id, err);
    return text('Retry', 500);
  }
  return text('ok', 200);
}
