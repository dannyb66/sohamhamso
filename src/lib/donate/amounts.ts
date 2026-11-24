/**
 * Pure amount maths shared by the browser (Stripe Elements amount) and the
 * server (PaymentIntent amount). Both sides MUST call `donationTotalMinor`
 * so the wallet sheet, the Payment Element and the charge always agree.
 *
 * Amounts are integers in the currency's minor unit (cents, paise).
 */

export type DonateCurrency = 'usd' | 'inr';

/**
 * Stripe US standard pricing used for the optional "cover the fees" top-up.
 *   usd: cards 2.9% + 30¢ (domestic). International cards cost 1.5% more;
 *        covering at the domestic rate keeps the top-up modest.
 *   inr: UPI for a US account 2% + 1.5% cross-border + 1% conversion, no
 *        fixed fee (stripe.com/pricing/local-payment-methods#upi).
 */
export const FEES: Record<DonateCurrency, { rate: number; fixedMinor: number }> = {
  usd: { rate: 0.029, fixedMinor: 30 },
  inr: { rate: 0.045, fixedMinor: 0 },
};

/** @deprecated kept for callers that predate multi-currency. */
export const CARD_FEE_RATE = FEES.usd.rate;
/** @deprecated kept for callers that predate multi-currency. */
export const CARD_FEE_FIXED_CENTS = FEES.usd.fixedMinor;

/**
 * Extra minor units a donor adds so the project nets `baseMinor` after fees:
 * gross = (base + fixed) / (1 − rate). Rounded up so the net is never short.
 */
export function feeCoverMinor(baseMinor: number, currency: DonateCurrency = 'usd'): number {
  if (!Number.isInteger(baseMinor) || baseMinor <= 0) return 0;
  const { rate, fixedMinor } = FEES[currency];
  const gross = Math.ceil((baseMinor + fixedMinor) / (1 - rate));
  return gross - baseMinor;
}

export function donationTotalMinor(
  baseMinor: number,
  coverFees: boolean,
  currency: DonateCurrency = 'usd',
): number {
  return baseMinor + (coverFees ? feeCoverMinor(baseMinor, currency) : 0);
}

export const feeCoverCents = (baseCents: number) => feeCoverMinor(baseCents, 'usd');
export const donationTotalCents = (baseCents: number, coverFees: boolean) =>
  donationTotalMinor(baseCents, coverFees, 'usd');

export function isDonateCurrency(v: unknown): v is DonateCurrency {
  return v === 'usd' || v === 'inr';
}

export type AmountCheck = { ok: true; cents: number } | { ok: false; message: string };

/** Validate a base gift (minor units) against bounds given in major units. */
export function checkBaseMinor(
  value: unknown,
  minMajor: number,
  maxMajor: number,
  currency: DonateCurrency = 'usd',
): AmountCheck {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return { ok: false, message: 'Enter a valid amount.' };
  }
  if (value < minMajor * 100) {
    return { ok: false, message: `The minimum gift is ${formatMoney(minMajor * 100, currency)}.` };
  }
  if (value > maxMajor * 100) {
    return {
      ok: false,
      message: `For gifts over ${formatMoney(maxMajor * 100, currency)}, please contact us.`,
    };
  }
  return { ok: true, cents: value };
}

export const checkBaseCents = (value: unknown, minDollars: number, maxDollars: number) =>
  checkBaseMinor(value, minDollars, maxDollars, 'usd');

/** "$12.34" / "₹1,001" / "12" → minor units; rejects junk and >2 decimals. */
export function parseMajorToMinor(input: string): number | null {
  const s = input.replace(/[$₹,\s]/g, '');
  const m = s.match(/^(\d{1,7})(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '0').padEnd(2, '0'));
}

export const parseDollarsToCents = parseMajorToMinor;

/** 1234 → "$12.34", 100100 (inr) → "₹1,001". Whole amounts drop the decimals. */
export function formatMoney(minor: number, currency: DonateCurrency = 'usd'): string {
  const major = minor / 100;
  const whole = Number.isInteger(major);
  if (currency === 'inr') {
    return `₹${major.toLocaleString('en-IN', {
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: 2,
    })}`;
  }
  return whole ? `$${major}` : `$${major.toFixed(2)}`;
}

export const formatUsd = (cents: number) => formatMoney(cents, 'usd');

/** Strip anything unsafe from a public ledger display name. */
export function cleanLedgerName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = Array.from(v)
    .filter((ch) => {
      const c = ch.charCodeAt(0);
      return c > 31 && c !== 127 && ch !== '<' && ch !== '>';
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return s || null;
}

/** Attribution tag from `?src=` → Stripe metadata / ledger `source`. */
export function cleanSource(v: unknown): string {
  const s = (typeof v === 'string' ? v : '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  return s || 'site';
}
