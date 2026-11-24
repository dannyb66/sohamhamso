import { Database } from 'bun:sqlite';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
/**
 * Unit tests for the donation feature:
 *   - amount maths shared by browser + server (fee cover, bounds, parsing)
 *   - INR (Stripe UPI) amounts and intents
 *   - Stripe REST form encoding + PaymentIntent creation (fetch stubbed)
 *   - webhook signature verification + ledger writes (in-memory SQLite
 *     standing in for D1, using the real migrations-ledger schema)
 *   - /api/donate/intent handler guards
 *
 * Run with: `bun --bun vitest run tests/unit/donate.test.ts`
 */
import { describe, expect, it, vi } from 'vitest';
import {
  checkBaseCents,
  checkBaseMinor,
  cleanLedgerName,
  cleanSource,
  donationTotalCents,
  donationTotalMinor,
  feeCoverCents,
  feeCoverMinor,
  formatMoney,
  formatUsd,
  parseDollarsToCents,
  parseMajorToMinor,
} from '../../src/lib/donate/amounts';
import { donateBounds } from '../../src/lib/donate/config';
import { type LedgerDb, handleStripeWebhook } from '../../src/lib/donate/ledger';
import {
  createDonationIntent,
  toFormBody,
  verifyStripeSignature,
} from '../../src/lib/donate/stripe';
import { POST as intentPOST } from '../../src/pages/api/donate/intent';

const LEDGER_SQL = readFileSync(
  resolve(__dirname, '..', '..', 'migrations-ledger', '0001_ledger.sql'),
  'utf8',
);

describe('amounts', () => {
  it('fee cover nets the base after 2.9% + 30¢', () => {
    for (const base of [300, 500, 1100, 2500, 10100, 500000]) {
      const gross = base + feeCoverCents(base);
      const net = gross - Math.round(gross * 0.029) - 30;
      expect(net).toBeGreaterThanOrEqual(base);
      expect(net - base).toBeLessThanOrEqual(1);
    }
    expect(feeCoverCents(1100)).toBe(64);
    expect(donationTotalCents(1100, false)).toBe(1100);
    expect(donationTotalCents(1100, true)).toBe(1164);
  });

  it('bounds and parsing', () => {
    expect(checkBaseCents(299, 3, 5000).ok).toBe(false);
    expect(checkBaseCents(300, 3, 5000)).toEqual({ ok: true, cents: 300 });
    expect(checkBaseCents(500001, 3, 5000).ok).toBe(false);
    expect(checkBaseCents(12.5, 3, 5000).ok).toBe(false);
    expect(checkBaseCents('1100', 3, 5000).ok).toBe(false);
    expect(parseDollarsToCents('15')).toBe(1500);
    expect(parseDollarsToCents('$1,015.5')).toBe(101550);
    expect(parseDollarsToCents('15.555')).toBeNull();
    expect(parseDollarsToCents('abc')).toBeNull();
    expect(formatUsd(1100)).toBe('$11');
    expect(formatUsd(1164)).toBe('$11.64');
  });

  it('sanitises ledger names and sources', () => {
    expect(cleanLedgerName('  Asha\n <script> ')).toBe('Asha script');
    expect(cleanLedgerName('   ')).toBeNull();
    expect(cleanLedgerName(42)).toBeNull();
    expect(cleanLedgerName('x'.repeat(100))?.length).toBe(60);
    expect(cleanSource('yt-pin')).toBe('yt-pin');
    expect(cleanSource('<x>')).toBe('x');
    expect(cleanSource(undefined)).toBe('site');
  });
});

describe('amounts (INR / Stripe UPI)', () => {
  it('fee cover nets the base after 4.5% with no fixed fee', () => {
    for (const base of [10000, 10100, 50100, 210100, 10000000]) {
      const gross = base + feeCoverMinor(base, 'inr');
      const net = gross - Math.round(gross * 0.045);
      expect(net).toBeGreaterThanOrEqual(base);
      expect(net - base).toBeLessThanOrEqual(1);
    }
    expect(feeCoverMinor(50100, 'inr')).toBe(2361);
    expect(donationTotalMinor(50100, true, 'inr')).toBe(52461);
    expect(donationTotalMinor(50100, false, 'inr')).toBe(50100);
  });

  it('bounds, parsing and formatting in rupees', () => {
    const b = donateBounds('inr');
    expect(b).toEqual({ min: 100, max: 100000 });
    expect(checkBaseMinor(9999, b.min, b.max, 'inr')).toEqual({
      ok: false,
      message: 'The minimum gift is ₹100.',
    });
    expect(checkBaseMinor(10000, b.min, b.max, 'inr')).toEqual({ ok: true, cents: 10000 });
    expect(checkBaseMinor(10000001, b.min, b.max, 'inr').ok).toBe(false);
    expect(parseMajorToMinor('₹1,001')).toBe(100100);
    expect(formatMoney(100100, 'inr')).toBe('₹1,001');
    expect(formatMoney(10000000, 'inr')).toBe('₹1,00,000');
    expect(formatMoney(52461, 'inr')).toBe('₹524.61');
    expect(donateBounds('usd')).toEqual({ min: 3, max: 5000 });
  });
});

describe('stripe client', () => {
  it('form-encodes nested params', () => {
    expect(toFormBody({ a: 1, b: { c: 'x y', d: { e: true } }, f: undefined })).toBe(
      'a=1&b%5Bc%5D=x%20y&b%5Bd%5D%5Be%5D=true',
    );
  });

  it('creates a PaymentIntent with metadata + idempotency', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: 'pi_1', client_secret: 'pi_1_secret' }), { status: 200 }),
    );
    const out = await createDonationIntent(
      'rk_test',
      {
        amountCents: 1164,
        baseCents: 1100,
        coverFees: true,
        source: 'yt',
        ledgerName: 'Asha',
        idempotencyKey: 'k-1234567890abcdef',
      },
      fetchImpl as unknown as typeof fetch,
    );
    expect(out).toEqual({ id: 'pi_1', clientSecret: 'pi_1_secret' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.stripe.com/v1/payment_intents');
    const headers = init.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('k-1234567890abcdef');
    const body = new URLSearchParams(String(init.body));
    expect(body.get('amount')).toBe('1164');
    expect(body.get('currency')).toBe('usd');
    expect(body.get('automatic_payment_methods[enabled]')).toBe('true');
    expect(body.get('payment_method_types[0]')).toBeNull();
    expect(body.get('allowed_payment_method_types[0]')).toBeNull();
    expect(body.get('metadata[kind]')).toBe('donation');
    expect(body.get('metadata[cover_fees]')).toBe('yes');
  });

  it('creates an INR PaymentIntent restricted to UPI', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: 'pi_2', client_secret: 'pi_2_secret' }), { status: 200 }),
    );
    await createDonationIntent(
      'rk_test',
      {
        amountCents: 52461,
        baseCents: 50100,
        coverFees: true,
        currency: 'inr',
        source: 'yt',
        ledgerName: null,
        idempotencyKey: 'k-1234567890abcdef',
      },
      fetchImpl as unknown as typeof fetch,
    );
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = new URLSearchParams(String(init.body));
    expect(body.get('currency')).toBe('inr');
    expect(body.get('amount')).toBe('52461');
    expect(body.get('allowed_payment_method_types[0]')).toBe('upi');
    expect(body.get('payment_method_types[0]')).toBeNull(); // removed in API endive
    expect(body.get('automatic_payment_methods[enabled]')).toBeNull();
    expect(body.get('metadata[currency]')).toBe('inr');
    expect(body.get('metadata[base_minor]')).toBe('50100');
  });

  it('throws on Stripe errors', async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ error: { message: 'bad key', code: 'api_key_invalid' } }), {
        status: 401,
      });
    await expect(
      createDonationIntent(
        'rk_bad',
        {
          amountCents: 500,
          baseCents: 500,
          coverFees: false,
          source: 'site',
          ledgerName: null,
          idempotencyKey: 'k-1234567890abcdef',
        },
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toThrow('bad key');
  });
});

// ── webhook + ledger ───────────────────────────────────────────────────
const SECRET = 'whsec_test';
const sign = (body: string, t = Math.floor(Date.now() / 1000)) =>
  `t=${t},v1=${createHmac('sha256', SECRET).update(`${t}.${body}`).digest('hex')}`;

function memoryLedger(): { db: Database; LEDGER_DB: LedgerDb } {
  const db = new Database(':memory:');
  db.exec(LEDGER_SQL);
  return {
    db,
    LEDGER_DB: {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            return {
              async run() {
                const r = db.prepare(sql.replace(/\?\d+/g, '?')).run(...(values as never[]));
                return { meta: { changes: r.changes } };
              },
            };
          },
        };
      },
    },
  };
}

const webhookReq = (body: string, sig = sign(body)) =>
  new Request('https://sohamhamso.org/api/donate/stripe-webhook', {
    method: 'POST',
    body,
    headers: { 'stripe-signature': sig },
  });

const piEvent = (id: string, over: Record<string, unknown> = {}) =>
  JSON.stringify({
    id,
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: 'pi_1',
        created: 1795000000,
        amount_received: 1164,
        currency: 'usd',
        status: 'succeeded',
        metadata: { kind: 'donation', source: 'yt', cover_fees: 'yes', ledger_name: ' Asha ' },
        ...over,
      },
    },
  });

describe('webhook', () => {
  it('verifies signatures', async () => {
    const b = '{"a":1}';
    expect(await verifyStripeSignature(b, sign(b), SECRET)).toBe(true);
    expect(await verifyStripeSignature(`${b} `, sign(b), SECRET)).toBe(false);
    expect(
      await verifyStripeSignature(b, sign(b, Math.floor(Date.now() / 1000) - 3600), SECRET),
    ).toBe(false);
    expect(await verifyStripeSignature(b, null, SECRET)).toBe(false);
    expect(await verifyStripeSignature(b, sign(b), undefined)).toBe(false);
  });

  it('records a donation once, survives retries, hides refunds', async () => {
    const { db, LEDGER_DB } = memoryLedger();
    const env = { STRIPE_WEBHOOK_SECRET: SECRET, LEDGER_DB };
    expect((await handleStripeWebhook(webhookReq(piEvent('evt_1')), env)).status).toBe(200);
    expect((await handleStripeWebhook(webhookReq(piEvent('evt_1')), env)).status).toBe(200);
    await handleStripeWebhook(webhookReq(piEvent('evt_2')), env); // same PI, new event id
    const rows = db.query('SELECT * FROM ledger_public').all() as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'stripe:pi_1',
      amount_minor: 1164,
      currency: 'USD',
      source: 'yt',
      display_name: 'Asha',
      memo: 'donor covered fees',
    });
    expect(Object.keys(rows[0] ?? {})).not.toContain('external_ref');

    const refund = JSON.stringify({
      id: 'evt_3',
      type: 'charge.refunded',
      data: { object: { payment_intent: 'pi_1', refunded: true } },
    });
    await handleStripeWebhook(webhookReq(refund), env);
    expect((db.query('SELECT COUNT(*) AS n FROM ledger_public').get() as { n: number }).n).toBe(0);
  });

  it('ignores non-donation intents and rejects bad signatures', async () => {
    const { db, LEDGER_DB } = memoryLedger();
    const env = { STRIPE_WEBHOOK_SECRET: SECRET, LEDGER_DB };
    expect((await handleStripeWebhook(webhookReq(piEvent('e1'), 't=1,v1=00'), env)).status).toBe(
      400,
    );
    await handleStripeWebhook(webhookReq(piEvent('e2', { metadata: { kind: 'book' } })), env);
    expect((db.query('SELECT COUNT(*) AS n FROM ledger_entries').get() as { n: number }).n).toBe(0);
  });

  it('stores test-mode events hidden with a stripe-test: prefix', async () => {
    const { db, LEDGER_DB } = memoryLedger();
    const env = { STRIPE_WEBHOOK_SECRET: SECRET, LEDGER_DB };
    const ev = JSON.stringify({ ...JSON.parse(piEvent('evt_t1')), livemode: false });
    expect((await handleStripeWebhook(webhookReq(ev), env)).status).toBe(200);
    expect((db.query('SELECT COUNT(*) AS n FROM ledger_public').get() as { n: number }).n).toBe(0);
    expect(db.query('SELECT id, is_public, memo FROM ledger_entries').get()).toEqual({
      id: 'stripe-test:pi_1',
      is_public: 0,
      memo: 'test · donor covered fees',
    });
  });

  it('records a UPI (INR) gift in paise', async () => {
    const { db, LEDGER_DB } = memoryLedger();
    const env = { STRIPE_WEBHOOK_SECRET: SECRET, LEDGER_DB };
    const ev = piEvent('evt_inr', {
      id: 'pi_inr',
      amount_received: 50100,
      currency: 'inr',
      metadata: { kind: 'donation', source: 'yt', cover_fees: 'no', currency: 'inr' },
    });
    expect((await handleStripeWebhook(webhookReq(ev), env)).status).toBe(200);
    expect(db.query('SELECT id, amount_minor, currency, memo FROM ledger_public').get()).toEqual({
      id: 'stripe:pi_inr',
      amount_minor: 50100,
      currency: 'INR',
      memo: null,
    });
  });

  it('returns 500 (retryable) without a ledger binding', async () => {
    const res = await handleStripeWebhook(webhookReq(piEvent('e3')), {
      STRIPE_WEBHOOK_SECRET: SECRET,
    });
    expect(res.status).toBe(500);
  });
});

// ── /api/donate/intent ─────────────────────────────────────────────────
type Ctx = Parameters<typeof intentPOST>[0];
const intentCtx = (
  body: unknown,
  origin: string | null = 'https://sohamhamso.org',
  env: Record<string, string> = { STRIPE_SECRET_KEY: 'rk_test' },
) =>
  ({
    request: new Request('https://sohamhamso.org/api/donate/intent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
      body: JSON.stringify(body),
    }),
    locals: { runtime: { env } },
  }) as unknown as Ctx;

describe('POST /api/donate/intent', () => {
  const good = {
    baseCents: 1100,
    coverFees: true,
    source: 'yt',
    ledgerName: '',
    idempotencyKey: 'abcdef0123456789',
  };

  it('rejects cross-origin and missing origin', async () => {
    expect((await intentPOST(intentCtx(good, 'https://evil.example'))).status).toBe(403);
    expect((await intentPOST(intentCtx(good, null))).status).toBe(403);
  });

  it('503 when Stripe is not configured', async () => {
    const prev = process.env.STRIPE_SECRET_KEY;
    // biome-ignore lint/performance/noDelete: env var must be absent, not "undefined"
    delete process.env.STRIPE_SECRET_KEY;
    expect((await intentPOST(intentCtx(good, undefined, {}))).status).toBe(503);
    if (prev !== undefined) process.env.STRIPE_SECRET_KEY = prev;
  });

  it('validates amount and idempotency key', async () => {
    expect((await intentPOST(intentCtx({ ...good, baseCents: 100 }))).status).toBe(400);
    expect((await intentPOST(intentCtx({ ...good, idempotencyKey: 'x' }))).status).toBe(400);
  });

  it('charges the server-computed total', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ id: 'pi_9', client_secret: 'pi_9_s' }), { status: 200 }),
      );
    const res = await intentPOST(intentCtx({ ...good, baseCents: 1100, coverFees: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, clientSecret: 'pi_9_s' });
    const body = new URLSearchParams(String((spy.mock.calls[0]?.[1] as RequestInit).body));
    expect(body.get('amount')).toBe('1164');
    spy.mockRestore();
  });
});

describe('POST /api/donate/intent (INR / UPI)', () => {
  const good = {
    currency: 'inr',
    baseCents: 50100,
    coverFees: true,
    source: 'yt',
    ledgerName: 'Asha',
    idempotencyKey: 'abcdef0123456789',
  };

  it('charges the INR total with UPI only', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ id: 'pi_7', client_secret: 'pi_7_s' }), { status: 200 }),
      );
    const res = await intentPOST(intentCtx(good));
    expect(res.status).toBe(200);
    const body = new URLSearchParams(String((spy.mock.calls[0]?.[1] as RequestInit).body));
    expect(body.get('currency')).toBe('inr');
    expect(body.get('amount')).toBe('52461');
    expect(body.get('allowed_payment_method_types[0]')).toBe('upi');
    expect(body.get('metadata[ledger_name]')).toBe('Asha');
    spy.mockRestore();
  });

  it('points donors to the card tab when Stripe rejects a UPI intent', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'upi is not activated', code: 'x' } }), {
        status: 400,
      }),
    );
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await intentPOST(intentCtx(good));
    expect(res.status).toBe(502);
    expect((await res.json()).message).toContain('give by card');
    spy.mockRestore();
    err.mockRestore();
  });

  it('applies rupee bounds and rejects unknown currencies', async () => {
    expect((await intentPOST(intentCtx({ ...good, baseCents: 9999 }))).status).toBe(400);
    expect((await intentPOST(intentCtx({ ...good, baseCents: 10000001 }))).status).toBe(400);
    expect((await intentPOST(intentCtx({ ...good, currency: 'eur' }))).status).toBe(400);
    expect((await intentPOST(intentCtx({ ...good, currency: 5 }))).status).toBe(400);
  });
});
