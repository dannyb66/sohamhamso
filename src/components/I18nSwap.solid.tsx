/**
 * I18nSwap — site-wide UI-chrome translation island.
 *
 * Mirrors the ReaderLangSwap pattern (verse-page corpus swap) but for
 * chrome strings (masthead, footer, subscribe band, buttons, aria
 * labels). SSR always renders English; on hydrate, this island reads
 * the user's chosen reader-lang from localStorage and rewrites every
 * `[data-i18n="key"]` element's textContent.
 *
 * Element conventions (rendered into the static HTML by Astro):
 *
 *   <span data-i18n="masthead.search.aria">Search verses, …</span>
 *     → textContent rewritten on swap.
 *
 *   <button
 *     data-i18n-attr-aria-label="masthead.search.aria"
 *     data-i18n-attr-title="masthead.search.aria"
 *     aria-label="Search verses, …"
 *   >…</button>
 *     → each `data-i18n-attr-{attr}` attribute names ONE attribute to
 *       swap (per-attribute keys, see design note). textContent of the
 *       element is left alone unless `data-i18n` is also present.
 *
 *   <input
 *     data-i18n-attr-placeholder="subscribe.email.placeholder"
 *     placeholder="your email"
 *   />
 *     → inputs commonly need multiple attrs translated; this scales.
 *
 * Behavior:
 *   - currentLang === 'en' → EARLY RETURN. Zero DOM writes. This
 *     preserves byte-identical SSR output for English visitors.
 *   - lang !== 'en' → loadDict(lang), walk both attribute selectors,
 *     rewrite. Missing keys fall back silently (the EN copy in the SSR
 *     HTML stays put — never blanks).
 *   - Listens for `sohamhamso:reader-lang-change` and re-applies on the
 *     fly. The lang-change handler always re-loads (so a switch from hi
 *     → ta picks up the right dict; a switch back to en restores the
 *     EN values).
 *   - Updates document.documentElement.lang so a11y trees + per-script
 *     CSS line-heights pick up the new language.
 *
 * Mounted globally in BaseLayout.astro with `client:idle` AFTER <slot/>
 * so the SSR DOM is fully present before hydrate fires.
 */
import { onCleanup, onMount } from 'solid-js';
import { type I18nKey, en, loadDict, t } from '../i18n';

const STORAGE_KEY = 'sohamhamso:reader-lang';

function currentLang(): string {
  if (typeof localStorage === 'undefined') return 'en';
  try {
    return localStorage.getItem(STORAGE_KEY) || 'en';
  } catch {
    return 'en';
  }
}

const ATTR_PREFIX = 'data-i18n-attr-';

/**
 * Walk the document and apply the loaded dict to every `[data-i18n]`
 * element (textContent) and every element bearing one or more
 * `data-i18n-attr-{name}` attributes (per-attribute rewrites).
 *
 * Pure DOM writes, no innerHTML — preserves nested elements (e.g. the
 * footer attribution sentence has anchor children that data-i18n on the
 * <p> wrapper would clobber; we keep keys on leaf <span>s).
 */
function applyDict(dict: Record<string, string>) {
  if (typeof document === 'undefined') return;

  // textContent rewrites.
  const textNodes = document.querySelectorAll<HTMLElement>('[data-i18n]');
  for (const el of Array.from(textNodes)) {
    const key = el.getAttribute('data-i18n') as I18nKey | null;
    if (!key) continue;
    const value = t(key, dict);
    // Only rewrite if the value actually differs from the existing text —
    // saves a layout invalidation per element on no-op swaps (e.g. on
    // re-apply after the same lang fires twice).
    if (el.textContent !== value) el.textContent = value;
  }

  // Attribute rewrites — selector matches any element with at least one
  // `data-i18n-attr-{name}` attribute. We can't query "starts-with" on
  // attribute name in CSS, so we scan all elements that we already know
  // are i18n candidates: union of `[data-i18n]` and a broad pass for any
  // element with any data-i18n-attr-* attribute. Pragmatic: walk every
  // element once.
  const attrCandidates = document.querySelectorAll<HTMLElement>('*');
  for (const el of Array.from(attrCandidates)) {
    // Iterate the element's attributes once; for each `data-i18n-attr-X`,
    // resolve the key and write attribute X.
    const attrs = el.attributes;
    for (let i = 0; i < attrs.length; i++) {
      const a = attrs[i];
      if (!a) continue;
      if (!a.name.startsWith(ATTR_PREFIX)) continue;
      const targetAttr = a.name.slice(ATTR_PREFIX.length);
      const key = a.value as I18nKey;
      const value = t(key, dict);
      if (el.getAttribute(targetAttr) !== value) {
        el.setAttribute(targetAttr, value);
      }
    }
  }
}

/**
 * Restore the EN dictionary in-place. Used when the user switches BACK
 * to English from a non-EN lang within the same page session — we can't
 * recover the original SSR strings any other way without a reload.
 */
function applyEnglish() {
  applyDict(en as unknown as Record<string, string>);
}

export default function I18nSwap() {
  let lastAppliedLang: string | null = null;

  const swapTo = async (lang: string) => {
    if (lang === 'en') {
      // If we previously swapped to a non-EN lang, restore EN strings.
      // If we never swapped (initial 'en'), this is a no-op.
      if (lastAppliedLang && lastAppliedLang !== 'en') {
        applyEnglish();
      }
      lastAppliedLang = 'en';
      if (typeof document !== 'undefined') {
        document.documentElement.setAttribute('lang', 'en');
      }
      return;
    }
    try {
      const dict = await loadDict(lang);
      applyDict(dict);
      lastAppliedLang = lang;
      if (typeof document !== 'undefined') {
        document.documentElement.setAttribute('lang', lang);
      }
    } catch {
      // Dict load failed — leave SSR EN in place. Never throw past the
      // island boundary; this is a non-fatal enhancement.
    }
  };

  const handleChange = (e: Event) => {
    const detail = (e as CustomEvent<{ lang?: string }>).detail;
    const lang = detail?.lang || currentLang();
    void swapTo(lang);
  };

  onMount(() => {
    if (typeof document === 'undefined') return;
    const initial = currentLang();
    // Only kick off the swap if the user has picked a non-EN reading
    // mode. The English visitor sees zero DOM writes — preserves the
    // byte-identical SSR output guarantee.
    //
    // Lang attribute (audit 2026-06-01 #9): SSR renders <html lang="en">
    // unconditionally. On hydrate, sync to the persisted reader-lang so
    // screen readers, :lang() CSS, and SEO crawlers see the correct
    // ISO 639-1 code. EN case is a defensive no-op write (idempotent —
    // attribute already 'en') so the contract holds even if a future
    // change has the SSR layer emit a different default.
    if (initial !== 'en') {
      void swapTo(initial);
    } else {
      lastAppliedLang = 'en';
      document.documentElement.setAttribute('lang', 'en');
    }
    document.addEventListener('sohamhamso:reader-lang-change', handleChange);
  });

  onCleanup(() => {
    if (typeof document === 'undefined') return;
    document.removeEventListener('sohamhamso:reader-lang-change', handleChange);
  });

  return null;
}
