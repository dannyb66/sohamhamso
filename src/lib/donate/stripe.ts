/**
 * Minimal Stripe REST client for the edge (no SDK: smaller worker bundle,
 * no Node built-ins). Only what /donate needs: create a PaymentIntent and
 * verify webhook signatures.
 */

const STRIPE_API = 'https://api.stripe.com/v1';
/** Pin the API version so Stripe changes can't silently alter payloads. */
export const STRIPE_API_VERSION = '2026-08-26.dahlia'; // keep equal to the live webhook endpoint's API version

export class StripeApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'StripeApiError';
  }
}

/** Flatten nested params into Stripe's form encoding (a[b][c]=v). */
export function toFormBody(params: Record<string, unknown>, prefix = ''): string {
  const out: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object' && !Array.isArray(v)) {
      const nested = toFormBody(v as Record<string, unknown>, key);
      if (nested) out.push(nested);
    } else if (Array.isArray(v)) {
      v.forEach((item, i) =>
        out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`),
      );
    } else {
      out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return out.join('&');
}

export interface CreateDonationIntentInput {
  /** Charged total in minor units (cents / paise). */
  amountCents: number;
  /** Gift before the optional fee top-up, minor units. */
  baseCents: number;
  /** usd → cards, wallets, Link, ACH (automatic); inr → UPI only. */
  currency?: 'usd' | 'inr';
  coverFees: boolean;
  source: string;
  ledgerName: string | null;
  idempotencyKey: string;
}

export interface DonationIntent {
  id: string;
  clientSecret: string;
}

export async function createDonationIntent(
  secretKey: string,
  input: CreateDonationIntentInput,
  fetchImpl: typeof fetch = fetch,
): Promise<DonationIntent> {
  const currency = input.currency ?? 'usd';
  const body = toFormBody({
    amount: input.amountCents,
    currency,
    // usd: cards, Apple Pay, Google Pay, Link, ACH and Instant Bank Payments
    // are switched on/off in Dashboard → Settings → Payment methods.
    // inr: UPI only. Must match the browser's Elements `allowedPaymentMethodTypes`.
    // allowed_payment_method_types (API ≥ 2026-07-29.dahlia) replaces
    // payment_method_types, which API 2026-09-30.endive removes.
    ...(currency === 'inr'
      ? { allowed_payment_method_types: ['upi'] }
      : { automatic_payment_methods: { enabled: true } }),
    description: 'Donation to sohamhamso',
    metadata: {
      kind: 'donation',
      source: input.source,
      currency,
      base_minor: input.baseCents,
      base_cents: input.baseCents,
      cover_fees: input.coverFees ? 'yes' : 'no',
      ledger_name: input.ledgerName ?? '',
    },
  });
  const res = await fetchImpl(`${STRIPE_API}/payment_intents`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': input.idempotencyKey,
      'Stripe-Version': STRIPE_API_VERSION,
    },
    body,
  });
  const json = (await res.json().catch(() => ({}))) as {
    id?: string;
    client_secret?: string;
    error?: { message?: string; code?: string };
  };
  if (!res.ok || !json.id || !json.client_secret) {
    throw new StripeApiError(
      json.error?.message ?? `Stripe HTTP ${res.status}`,
      res.status,
      json.error?.code,
    );
  }
  return { id: json.id, clientSecret: json.client_secret };
}

const enc = new TextEncoder();
const SIGNATURE_TOLERANCE_SECONDS = 300;

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) return null;
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Verify `Stripe-Signature` (v1 = HMAC-SHA256 over `${t}.${rawBody}`).
 * `crypto.subtle.verify` compares in constant time.
 */
export async function verifyStripeSignature(
  rawBody: string,
  header: string | null,
  secret: string | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!header || !secret) return false;
  let t = Number.NaN;
  const v1: string[] = [];
  for (const part of header.split(',')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === 't') t = Number(v);
    else if (k === 'v1' && v) v1.push(v);
  }
  if (!Number.isFinite(t) || v1.length === 0) return false;
  if (Math.abs(nowSeconds - t) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const payload = enc.encode(`${t}.${rawBody}`);
  for (const sig of v1) {
    const bytes = hexToBytes(sig);
    if (bytes && (await crypto.subtle.verify('HMAC', key, bytes, payload))) return true;
  }
  return false;
}
