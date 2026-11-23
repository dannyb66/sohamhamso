/**
 * analytics-client.ts — browser runtime for the opt-in GA4 integration.
 *
 * Loaded only by `src/components/AnalyticsConsent.astro`, which itself is
 * only rendered when a valid `PUBLIC_GA_MEASUREMENT_ID` exists at build time
 * and the page has not opted out (`<BaseLayout analytics={false}>`).
 *
 * Flow:
 *   1. Queue Consent Mode defaults (everything denied).
 *   2. GPC on            → never load, never show the banner.
 *      stored 'granted'  → load gtag.js once the page is idle.
 *      stored 'denied'   → do nothing.
 *      no choice yet     → show the consent banner.
 *   3. Expose `window.sohamhamsoAnalytics` so the Settings sheet can show and
 *      change the choice later (withdrawal deletes GA cookies).
 *   4. Forward a small set of existing site events to GA — only after load.
 */
import {
  ANALYTICS_CONSENT_EVENT,
  ANALYTICS_CONSENT_KEY,
  type AnalyticsConsent,
  derivePageContext,
  isValidMeasurementId,
  parseConsent,
} from './analytics';

type Gtag = (...args: unknown[]) => void;

export interface SohamhamsoAnalyticsApi {
  /** Current stored choice, or null if the visitor has not chosen yet. */
  getConsent(): AnalyticsConsent | null;
  /** Persist a choice; 'granted' loads GA, 'denied' stops it and clears cookies. */
  setConsent(next: AnalyticsConsent): void;
  /** True when the browser sends a Global Privacy Control signal. */
  readonly gpc: boolean;
}

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
    sohamhamsoAnalytics?: SohamhamsoAnalyticsApi;
  }
  interface Navigator {
    globalPrivacyControl?: boolean;
  }
}

const GTAG_SRC = 'https://www.googletagmanager.com/gtag/js?id=';

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode — the choice then lasts for this page only */
  }
}

/** Remove `_ga` / `_ga_<stream>` cookies on the host and its parent domain. */
function deleteGaCookies(): void {
  const names = document.cookie
    .split(';')
    .map((part) => part.split('=')[0]?.trim())
    .filter((name): name is string => !!name && (name === '_ga' || name.startsWith('_ga_')));
  if (names.length === 0) return;
  const host = location.hostname;
  const parts = host.split('.');
  const domains = new Set<string>(['', host, `.${host}`]);
  if (parts.length > 2) domains.add(`.${parts.slice(-2).join('.')}`);
  for (const name of names) {
    for (const domain of domains) {
      const domainAttr = domain ? `; domain=${domain}` : '';
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${domainAttr}`;
    }
  }
}

function whenIdle(fn: () => void): void {
  const run = () => {
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(fn, { timeout: 4000 });
    } else {
      setTimeout(fn, 1500);
    }
  };
  if (document.readyState === 'complete') run();
  else window.addEventListener('load', run, { once: true });
}

export function initAnalytics(): void {
  const banner = document.querySelector<HTMLElement>('[data-consent-banner]');
  const measurementId = banner?.dataset.gaId;
  if (!banner || !isValidMeasurementId(measurementId)) return;
  if (window.sohamhamsoAnalytics) return; // already initialised on this page

  window.dataLayer = window.dataLayer || [];
  // gtag.js requires the real `arguments` object, not a spread array.
  const gtag: Gtag = function gtag() {
    // biome-ignore lint/style/noArguments: gtag.js contract
    window.dataLayer?.push(arguments);
  };
  window.gtag = gtag;

  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
  });

  const gpc = navigator.globalPrivacyControl === true;
  const disableFlag = `ga-disable-${measurementId}`;
  const flags = window as unknown as Record<string, unknown>;
  // `active`: consent granted on this page and GA allowed to send.
  // `injected`: gtag.js requested (at most once per page load).
  let active = false;
  let injected = false;
  // In-memory mirror of the stored choice, so the choice still holds for
  // this page when localStorage is unavailable (private mode, blocked).
  let choice: AnalyticsConsent | null = parseConsent(readStorage(ANALYTICS_CONSENT_KEY));

  // Page-level dimensions, attached explicitly to every event we send.
  // Verified against live gtag.js (2026-11-23): values given to
  // gtag('set', {...}) or as extra `config` fields are NOT forwarded as
  // event parameters, so each gtag('event') call must carry them itself.
  // Enhanced-measurement events (scroll, click, view_search_results) are
  // sent by gtag.js and therefore do not carry these dimensions.
  let dimensions: Record<string, string> = {
    ...derivePageContext(location.pathname),
    page_lang: document.documentElement.lang || 'en',
    reader_lang: readStorage('sohamhamso:reader-lang') || 'en',
    reading_script: readStorage('sohamhamso:script') || 'default',
  };

  const load = () => {
    // Check the current choice, not the one at scheduling time: the idle
    // callback for a returning visitor can fire after they withdrew consent
    // (in Settings, or in another tab).
    if (active || gpc || choice !== 'granted') return;
    active = true;
    flags[disableFlag] = false;
    gtag('consent', 'update', { analytics_storage: 'granted' });
    if (injected) return; // re-grant after a withdrawal on the same page
    injected = true;
    gtag('js', new Date());
    gtag('config', measurementId, {
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      // Sent below with the page dimensions attached.
      send_page_view: false,
    });
    gtag('event', 'page_view', { ...dimensions });
    const script = document.createElement('script');
    script.async = true;
    script.src = GTAG_SRC + encodeURIComponent(measurementId);
    script.dataset.analytics = 'gtag';
    document.head.appendChild(script);
  };

  const track = (name: string, params: Record<string, unknown> = {}) => {
    if (!active) return;
    gtag('event', name, { ...dimensions, ...params });
  };

  const hideBanner = () => banner.setAttribute('hidden', '');

  const stopCollection = () => {
    if (active) gtag('consent', 'update', { analytics_storage: 'denied' });
    active = false;
    flags[disableFlag] = true;
    deleteGaCookies();
  };

  const notify = (consent: AnalyticsConsent) =>
    document.dispatchEvent(new CustomEvent(ANALYTICS_CONSENT_EVENT, { detail: { consent } }));

  const api: SohamhamsoAnalyticsApi = {
    gpc,
    getConsent: () => choice,
    setConsent(next) {
      if (gpc && next === 'granted') return; // GPC is a standing refusal
      choice = next;
      writeStorage(ANALYTICS_CONSENT_KEY, next);
      hideBanner();
      if (next === 'granted') load();
      else stopCollection();
      notify(next);
    },
  };
  window.sohamhamsoAnalytics = api;

  banner
    .querySelector('[data-consent-accept]')
    ?.addEventListener('click', () => api.setConsent('granted'));
  banner
    .querySelector('[data-consent-decline]')
    ?.addEventListener('click', () => api.setConsent('denied'));

  // ── Forward existing site events (no-ops until GA is loaded) ──────────
  // Event parameter names below must match the custom definitions
  // registered in GA4 (docs/GA4-SETUP.md § Custom definitions).
  document.addEventListener('sohamhamso:reader-lang-change', (event) => {
    const lang = event instanceof CustomEvent ? event.detail?.lang : undefined;
    if (!active || typeof lang !== 'string') return;
    // Update the page-level dimensions first so this event (and any that
    // follow on this page) carries the new choice.
    dimensions = {
      ...dimensions,
      reader_lang: lang,
      reading_script: readStorage('sohamhamso:script') || 'default',
    };
    track('reader_lang_change');
  });
  document.addEventListener('sohamhamso:translations-changed', (event) => {
    const selected = event instanceof CustomEvent ? event.detail?.selected : undefined;
    const langs = Array.isArray(selected) ? selected.map(String) : [];
    track('parallel_translations_change', {
      parallel_count: langs.length,
      parallel_langs: langs.join(','),
    });
  });
  document.addEventListener('sohamhamso:open-settings', () => track('settings_open'));
  document.addEventListener(
    'submit',
    (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || !form.matches('[data-subscribe-form]')) return;
      // The form is `novalidate` (JS handles errors), so only count
      // submissions the browser would consider valid.
      if (!form.checkValidity()) return;
      // Never the address — only the chosen delivery language.
      const language = new FormData(form).get('language');
      track('subscribe_submit', { subscribe_lang: typeof language === 'string' ? language : '' });
    },
    true,
  );

  // Keep every open tab in step with a choice made in another tab.
  window.addEventListener('storage', (event) => {
    if (event.key !== ANALYTICS_CONSENT_KEY) return;
    const next = parseConsent(event.newValue);
    if (next === null || gpc) return;
    choice = next;
    hideBanner();
    if (next === 'granted') load();
    else stopCollection();
    notify(next);
  });

  // ── Initial state ──────────────────────────────────────────────────────
  if (gpc) return;
  if (choice === 'granted') whenIdle(load);
  else if (choice === null) banner.removeAttribute('hidden');
}
