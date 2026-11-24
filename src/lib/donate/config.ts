/// <reference types="astro/client" />
/**
 * Public donation configuration for /donate.
 *
 * Everything here is rendered into public HTML. Secrets never live here:
 *   - STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET → Cloudflare Pages secrets
 *   - PUBLIC_STRIPE_PUBLISHABLE_KEY → Pages build env var (pk_test_… on
 *     preview, pk_live_… on production). It is public by design.
 *
 * A rail whose required value is empty is hidden, so this file is safe to
 * ship before every account exists. See docs/DONATIONS.md for setup.
 */

export interface DonateConfig {
  /**
   * India: UPI through Stripe (INR presentment, settles in USD to the
   * maintainer's US Stripe balance). Shown when a publishable key is set.
   * Stripe's UPI limits are ₹1 to ₹1,00,000 per payment (dashboard minimum
   * is the INR equivalent of $0.50).
   */
  india: {
    enabled: boolean;
    presets: number[];
    defaultPreset: number;
    minRupees: number;
    maxRupees: number;
  };
  global: {
    currency: 'usd';
    presets: number[];
    defaultPreset: number;
    /** Minimum and maximum one-time gift in dollars (card-testing guard). */
    minDollars: number;
    maxDollars: number;
    /** Optional hosted fallback (Stripe Payment Link) used when no publishable key is set. */
    fallbackPaymentLinkUrl: string;
  };
  /** github.com/sponsors/<account>; empty hides it. */
  githubSponsorsUrl: string;
  /** Large gifts / refunds contact (mailto: or URL); empty hides those lines. */
  contactUrl: string;
  /** Public ledger page once live; empty hides the link. */
  ledgerUrl: string;
}

export const donateConfig: DonateConfig = {
  india: {
    enabled: true,
    presets: [101, 251, 501, 1001, 2101],
    defaultPreset: 501,
    minRupees: 100,
    maxRupees: 100000,
  },
  global: {
    currency: 'usd',
    presets: [5, 11, 25, 51, 101],
    defaultPreset: 11,
    minDollars: 3,
    maxDollars: 5000,
    fallbackPaymentLinkUrl: '',
  },
  githubSponsorsUrl: '', // TODO(donations): https://github.com/sponsors/<account>
  contactUrl: '', // TODO(donations): mailto:… — used for large gifts and refunds
  ledgerUrl: '',
};

/**
 * UPI needs Stripe's per-account approval (live UPI was rejected for this
 * account on 24 Nov 2026), so the UPI tab ships hidden and is switched on per
 * environment with PUBLIC_DONATE_UPI=1 (a Pages secret, read at build time).
 * Preview has it (sandbox UPI works); set it on Production only once
 * Dashboard → Payment methods shows UPI as Enabled in live mode.
 */
export function upiEnabled(): boolean {
  const flag = String(import.meta.env.PUBLIC_DONATE_UPI ?? '').trim();
  return donateConfig.india.enabled && flag === '1';
}

/** Gift bounds in major units for a currency (used by browser and server). */
export function donateBounds(currency: 'usd' | 'inr'): { min: number; max: number } {
  return currency === 'inr'
    ? { min: donateConfig.india.minRupees, max: donateConfig.india.maxRupees }
    : { min: donateConfig.global.minDollars, max: donateConfig.global.maxDollars };
}
