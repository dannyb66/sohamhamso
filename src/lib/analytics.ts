/**
 * analytics.ts — pure helpers for the opt-in Google Analytics 4 integration.
 *
 * Privacy contract (see /about/privacy and docs/GA4-SETUP.md):
 *   - GA is OFF unless `PUBLIC_GA_MEASUREMENT_ID` is set at build time
 *     (Cloudflare Pages *Production* environment only). Dev, CI and preview
 *     builds ship zero analytics code paths.
 *   - Consent-first ("basic" Consent Mode): gtag.js is not requested, and no
 *     cookie is set, until the visitor explicitly allows analytics.
 *   - A browser Global Privacy Control signal is treated as a refusal.
 *   - Google Signals and ad personalization are disabled in the tag config.
 *
 * Everything in this module is side-effect free so it can be unit tested
 * and shared between the Astro component (build time) and the client
 * runtime (`analytics-client.ts`).
 */

/** localStorage key holding the visitor's choice: 'granted' | 'denied'. */
export const ANALYTICS_CONSENT_KEY = 'sohamhamso:analytics-consent';

/** DOM event dispatched on `document` whenever the stored choice changes. */
export const ANALYTICS_CONSENT_EVENT = 'sohamhamso:analytics-consent-changed';

export type AnalyticsConsent = 'granted' | 'denied';

/**
 * GA4 web-stream measurement IDs look like `G-XXXXXXXXXX` (uppercase
 * alphanumerics). Anything else is rejected so a malformed env var can never
 * be interpolated into a script URL.
 */
export function isValidMeasurementId(id: unknown): id is string {
  return typeof id === 'string' && /^G-[A-Z0-9]{4,16}$/.test(id);
}

export function parseConsent(raw: string | null | undefined): AnalyticsConsent | null {
  return raw === 'granted' || raw === 'denied' ? raw : null;
}

/**
 * Locale prefixes used by the router (`astro.config.mjs` → i18n.locales,
 * minus the unprefixed default `en`). Kept as a literal so the client bundle
 * does not pull in the SEO module graph; a unit test pins it to
 * `NON_ENGLISH_LANGS`.
 */
export const LOCALE_PREFIXES = [
  'hi',
  'ta',
  'te',
  'bn',
  'mr',
  'gu',
  'kn',
  'ml',
  'pa',
  'or',
  'as',
] as const;

/** First path segments that are site chrome, not `/[tradition]/[text]/…`. */
const CHROME_SEGMENTS = new Set([
  'about',
  'cite',
  'confirmed',
  'daily',
  'dataset',
  'donate',
  'lemma',
  'sample',
  'search',
  'texts',
  'unsubscribed',
]);

export interface PageContext {
  /** GA4 built-in content grouping: 'home' | 'reader' | chrome segment. */
  content_group: string;
  /** Reader pages only: tradition slug (first path segment after locale). */
  tradition?: string;
  /** Reader pages only: text slug (second path segment after locale). */
  text_slug?: string;
}

/**
 * Classify a pathname into a coarse content group so GA reports can be cut
 * by reader vs. chrome and by text, independent of URL locale prefix.
 */
export function derivePageContext(pathname: string): PageContext {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length > 0 && (LOCALE_PREFIXES as readonly string[]).includes(segments[0])) {
    segments.shift();
  }
  if (segments.length === 0) return { content_group: 'home' };
  const [first, second] = segments;
  if (CHROME_SEGMENTS.has(first)) return { content_group: first };
  const context: PageContext = { content_group: 'reader', tradition: first };
  if (second) context.text_slug = second;
  return context;
}
