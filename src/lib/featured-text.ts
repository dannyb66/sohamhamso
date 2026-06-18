/**
 * featured-text.ts — config + expiry logic for the self-expiring
 * "New: {title} — {descriptor} →" launch-feature line on the homepage
 * (rendered by src/components/FeaturedNewText.astro).
 *
 * The line is a launch beat, not a permanent fixture: when a new text
 * ships, fill FEATURED_TEXT below; once `featured_until` passes, the
 * line silently disappears — no redeploy, no stale "New" badge rotting
 * on the homepage.
 *
 * Per-locale title/descriptor live HERE (not in src/i18n/*) because the
 * copy is per-launch editorial content, not site chrome. Only the static
 * "New" label goes through the i18n dictionaries (`featured.new_label`).
 *
 * V1 ships EMPTY (null) — no text is featured yet. Wave 1's launch beat
 * fills it, e.g.:
 *
 *   export const FEATURED_TEXT: FeaturedTextConfig | null = {
 *     slug: 'trika/vijnana-bhairava-tantra',
 *     featured_until: '2026-08-01T00:00:00Z',
 *     locales: {
 *       en: { title: 'Vijñāna Bhairava Tantra', descriptor: '112 dhāraṇās' },
 *       hi: { title: 'विज्ञान भैरव तंत्र', descriptor: '112 धारणाएँ' },
 *       // … remaining locales fall back to `en` when omitted.
 *     },
 *   };
 */

export interface FeaturedTextCopy {
  title: string;
  descriptor: string;
}

export interface FeaturedTextConfig {
  /** Text path slug as routed, e.g. 'trika/vijnana-bhairava-tantra'. */
  slug: string;
  /**
   * ISO 8601 instant after which the line stops rendering. A date-only
   * value ('2026-08-01') parses as 00:00 UTC of that day — i.e. the line
   * disappears at the START of that date. Use a full datetime if you
   * want end-of-day semantics.
   */
  featured_until: string;
  /** Per-locale copy. `en` is the fallback for any missing locale. */
  locales: Record<string, FeaturedTextCopy>;
}

/**
 * Pure expiry check — true iff `config` is filled, well-formed, and
 * `now` is strictly before `featured_until`. Never throws: a missing
 * config, blank slug, or unparseable date all read as "nothing to
 * feature" rather than blowing up the homepage.
 */
export function shouldFeature(
  config: FeaturedTextConfig | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!config || !config.slug || !config.featured_until) return false;
  const until = Date.parse(config.featured_until);
  if (Number.isNaN(until)) return false;
  return now.getTime() < until;
}

/**
 * Resolve the copy for `lang`, falling back to `en`, then null (which
 * the component treats as "render nothing" — a config without even an
 * `en` entry is malformed, fail quiet).
 */
export function featuredCopy(config: FeaturedTextConfig, lang: string): FeaturedTextCopy | null {
  return config.locales[lang] ?? config.locales.en ?? null;
}

/** The currently featured text. EMPTY at V1 — Wave 1 fills it. */
export const FEATURED_TEXT: FeaturedTextConfig | null = null;
